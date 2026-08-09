// ============================================================================
// x18_link.cpp — see x18_link.hpp.
// ============================================================================
#include "liveplay/net/x18_link.hpp"

#include "liveplay/net/osc_client.hpp"
#include "liveplay/logger.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <limits>

#if defined(_WIN32)
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
#  include <winsock2.h>
#  include <ws2tcpip.h>
#  pragma comment(lib, "ws2_32.lib")
   using socket_t = SOCKET;
#  define LP_INVALID_SOCKET INVALID_SOCKET
#  define LP_CLOSE_SOCKET ::closesocket
#else
#  include <arpa/inet.h>
#  include <netinet/in.h>
#  include <sys/socket.h>
#  include <sys/types.h>
#  include <unistd.h>
   using socket_t = int;
#  define LP_INVALID_SOCKET (-1)
#  define LP_CLOSE_SOCKET ::close
#endif

namespace liveplay::net {

namespace {

constexpr std::uint16_t kOscPort = 10024;
// The desk drops the subscription after ~10s. Half that leaves room for one
// lost datagram without a gap in the updates.
constexpr auto kSubscribeEvery = std::chrono::seconds{5};
// A full re-read costs ~119 tiny datagrams. Doing it periodically is how the
// cache heals after packet loss, which UDP gives us for free.
constexpr auto kResweepEvery = std::chrono::seconds{15};
constexpr auto kTick = std::chrono::milliseconds{100};
// Queries per tick. The whole sweep therefore takes ~1.5s rather than arriving
// as one burst a small embedded network stack has to absorb.
constexpr std::size_t kSweepBatch = 8;
// Below this, a "change" is float noise from the console's own quantisation
// and not worth waking every connected client for.
constexpr float kEpsilon = 1e-4f;

#if defined(_WIN32)
struct WsaGuard {
    bool ok = false;
    WsaGuard()  { WSADATA d{}; ok = (WSAStartup(MAKEWORD(2, 2), &d) == 0); }
    ~WsaGuard() { if (ok) WSACleanup(); }
};
#endif

} // namespace

// ---------------------------------------------------------------------------

X18Link& X18Link::instance() {
    static X18Link link;
    return link;
}

X18Link::X18Link() {
    running_.store(true);
    thread_ = std::thread([this] { run(); });
}

X18Link::~X18Link() { stop(); }

void X18Link::stop() {
    if (!running_.exchange(false)) return;
    wake_.notify_all();
    if (thread_.joinable()) thread_.join();
    std::lock_guard lock{mutex_};
    close_socket_locked();
}

void X18Link::configure(const std::string& ip) {
    {
        std::lock_guard lock{mutex_};
        if (ip_ == ip) return;
        ip_ = ip;
        // The cache described the previous desk. Keeping it would show one
        // console's levels while talking to another — worse than showing none.
        values_.clear();
        pending_changes_.clear();
        // A restore point is a position on the OLD desk. Carrying it over would
        // put a channel of the new one somewhere nobody chose.
        restore_points_.clear();
        sweep_pos_ = 0;
        resweep_ = true;
        Logger::info("X18: link now targeting '{}'", ip.empty() ? "(none)" : ip);
    }
    wake_.notify_all();
}

std::string X18Link::console_ip() const {
    std::lock_guard lock{mutex_};
    return ip_;
}

void X18Link::set_change_handler(std::function<void(const nlohmann::json&)> fn) {
    std::lock_guard lock{mutex_};
    on_change_ = std::move(fn);
}

float X18Link::value_of(const std::string& address) const {
    std::lock_guard lock{mutex_};
    auto it = values_.find(address);
    return it == values_.end() ? std::numeric_limits<float>::quiet_NaN() : it->second;
}

void X18Link::set_restore_point(const std::string& address, float pos) {
    std::lock_guard lock{mutex_};
    restore_points_[address] = pos;
}

float X18Link::take_restore_point(const std::string& address) {
    std::lock_guard lock{mutex_};
    auto it = restore_points_.find(address);
    if (it == restore_points_.end()) return std::numeric_limits<float>::quiet_NaN();
    const float pos = it->second;
    restore_points_.erase(it);
    return pos;
}

nlohmann::json X18Link::snapshot() const {
    std::lock_guard lock{mutex_};
    nlohmann::json values = nlohmann::json::object();
    for (const auto& [address, value] : values_) values[address] = value;
    return nlohmann::json{
        {"ip", ip_},
        {"connected", !ip_.empty() && socket_ready_},
        {"values", std::move(values)},
    };
}

void X18Link::open_socket_locked() {
    if (socket_ready_) return;
#if defined(_WIN32)
    static WsaGuard guard;
    (void)guard;
#endif
    socket_t s = ::socket(AF_INET, SOCK_DGRAM, 0);
    if (s == LP_INVALID_SOCKET) {
        Logger::warn("X18: socket() failed; console updates unavailable");
        return;
    }
    // Bind to an ephemeral port and keep it: the console answers queries and
    // sends /xremote updates to the SOURCE port, so this port is our address
    // for the rest of the process's life.
    sockaddr_in local{};
    local.sin_family = AF_INET;
    local.sin_addr.s_addr = INADDR_ANY;
    local.sin_port = 0;
    if (::bind(s, reinterpret_cast<sockaddr*>(&local), sizeof(local)) != 0) {
        Logger::warn("X18: bind() failed; console updates unavailable");
        LP_CLOSE_SOCKET(s);
        return;
    }
    // A receive timeout is what lets one thread both listen and keep the
    // subscription alive without a second thread or non-blocking bookkeeping.
#if defined(_WIN32)
    DWORD timeout_ms = static_cast<DWORD>(kTick.count());
    ::setsockopt(s, SOL_SOCKET, SO_RCVTIMEO,
                 reinterpret_cast<const char*>(&timeout_ms), sizeof(timeout_ms));
#else
    timeval tv{};
    tv.tv_sec = 0;
    tv.tv_usec = static_cast<int>(kTick.count() * 1000);
    ::setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
#endif
    sock_ = static_cast<std::intptr_t>(s);
    socket_ready_ = true;
}

void X18Link::close_socket_locked() {
    if (!socket_ready_) return;
    LP_CLOSE_SOCKET(static_cast<socket_t>(sock_));
    sock_ = -1;
    socket_ready_ = false;
}

bool X18Link::send_raw(const std::vector<char>& packet) {
    std::string ip;
    socket_t s = LP_INVALID_SOCKET;
    {
        std::lock_guard lock{mutex_};
        if (ip_.empty()) return false;
        open_socket_locked();
        if (!socket_ready_) return false;
        ip = ip_;
        s = static_cast<socket_t>(sock_);
    }
    sockaddr_in dest{};
    dest.sin_family = AF_INET;
    dest.sin_port = htons(kOscPort);
    if (inet_pton(AF_INET, ip.c_str(), &dest.sin_addr) != 1) {
        Logger::warn("X18: invalid console IP '{}'", ip);
        return false;
    }
    const auto n = ::sendto(s, packet.data(), static_cast<int>(packet.size()), 0,
                            reinterpret_cast<sockaddr*>(&dest), sizeof(dest));
    return n >= 0;
}

bool X18Link::send_float(const std::string& address, float value) {
    if (address.empty()) return false;
    if (!send_raw(osc_build_float(address, value))) return false;
    // Optimistic: the operator who moved the fader should not wait a round trip
    // to see it, and every other client should learn about it now rather than
    // when the desk gets around to echoing.
    note_value(address, value);
    return true;
}

bool X18Link::send_int(const std::string& address, std::int32_t value) {
    if (address.empty()) return false;
    if (!send_raw(osc_build_int(address, value))) return false;
    // Optimistic for the same reason send_float() is — and it matters more here.
    // A mute is a two-state control: without this the button an operator just
    // pressed stays visually unmuted until the desk echoes, which reads as "it
    // did not work" and invites a second press that mutes it right back.
    note_value(address, static_cast<float>(value));
    return true;
}

void X18Link::note_value(const std::string& address, float value) {
    std::lock_guard lock{mutex_};
    auto it = values_.find(address);
    if (it != values_.end() && std::fabs(it->second - value) < kEpsilon) return;
    values_[address] = value;
    pending_changes_[address] = value;
}

void X18Link::flush_changes() {
    nlohmann::json payload;
    std::function<void(const nlohmann::json&)> handler;
    {
        std::lock_guard lock{mutex_};
        if (pending_changes_.empty() || !on_change_) return;
        payload = nlohmann::json::object();
        for (const auto& [address, value] : pending_changes_) payload[address] = value;
        pending_changes_.clear();
        handler = on_change_;
    }
    // Outside the lock: the handler fans out to every WebSocket client and
    // takes the server's own mutexes on the way.
    try { handler(payload); }
    catch (const std::exception& e) { Logger::warn("X18: change handler threw: {}", e.what()); }
}

void X18Link::run() {
    auto last_subscribe = std::chrono::steady_clock::now() - kSubscribeEvery;
    auto last_sweep_start = std::chrono::steady_clock::now() - kResweepEvery;
    std::vector<char> buffer(2048);

    while (running_.load()) {
        bool configured = false;
        {
            std::unique_lock lock{mutex_};
            if (ip_.empty()) {
                close_socket_locked();
                // Nothing to talk to. Sleep until someone points us at a desk.
                wake_.wait_for(lock, std::chrono::milliseconds{500});
                continue;
            }
            open_socket_locked();
            configured = socket_ready_;
        }
        if (!configured) {
            std::unique_lock lock{mutex_};
            wake_.wait_for(lock, std::chrono::seconds{2});   // retry the socket
            continue;
        }

        const auto now = std::chrono::steady_clock::now();

        // 1. Keep the push subscription alive.
        if (now - last_subscribe >= kSubscribeEvery) {
            last_subscribe = now;
            send_raw(osc_build_query("/xremote"));
        }

        // 2. Walk the parameter list a few at a time. A sweep runs to the end,
        //    then waits out kResweepEvery before starting over.
        {
            const auto& addresses = x18_watched_addresses();
            std::size_t pos = 0;
            {
                std::lock_guard lock{mutex_};
                if (resweep_) { resweep_ = false; sweep_pos_ = 0; }
                if (sweep_pos_ >= addresses.size() &&
                    now - last_sweep_start >= kResweepEvery) {
                    sweep_pos_ = 0;
                }
                pos = sweep_pos_;
            }
            if (pos == 0) last_sweep_start = now;    // a fresh sweep begins here
            if (pos < addresses.size()) {
                const std::size_t end = std::min(pos + kSweepBatch, addresses.size());
                for (std::size_t i = pos; i < end; ++i)
                    send_raw(osc_build_query(addresses[i]));
                std::lock_guard lock{mutex_};
                // Only advance if nothing restarted the sweep while we were
                // sending (configure() can land between the two locks).
                if (sweep_pos_ == pos) sweep_pos_ = end;
            }
        }

        // 3. Drain whatever the desk has said. The socket's receive timeout is
        //    what paces this loop.
        socket_t s;
        {
            std::lock_guard lock{mutex_};
            if (!socket_ready_) continue;
            s = static_cast<socket_t>(sock_);
        }
        for (int drained = 0; drained < 64; ++drained) {
            const auto n = ::recvfrom(s, buffer.data(), static_cast<int>(buffer.size()),
                                      0, nullptr, nullptr);
            if (n <= 0) break;                    // timeout or error: back to the top
            osc_for_each_message(buffer.data(), static_cast<std::size_t>(n),
                                 [this](const OscMessage& m) {
                                     if (m.type == 'f') { note_value(m.address, m.f); return; }
                                     // The on/off switch beside every level is an
                                     // int, so ints cannot simply be dropped any
                                     // more. They are filtered to the addresses we
                                     // actually asked for, because /xremote pushes
                                     // every int on the desk — gates, EQ enables,
                                     // routing — and none of those are ours.
                                     if (m.type == 'i' && x18_is_watched_address(m.address))
                                         note_value(m.address, static_cast<float>(m.i));
                                     // Strings (channel names, scene names) never are.
                                 });
        }

        flush_changes();
    }
}

} // namespace liveplay::net
