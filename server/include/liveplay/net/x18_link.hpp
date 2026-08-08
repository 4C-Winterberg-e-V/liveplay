// ============================================================================
// liveplay/net/x18_link.hpp
// ----------------------------------------------------------------------------
// A live, two-way link to a Behringer X-Air console (X18 / XR18 / XR16 / XR12).
//
// Why this exists: osc_client.hpp can only SEND. It opens a socket, fires one
// datagram and closes it — fine for "set the master fader to 0%" on a cue, and
// useless for showing an operator what the desk is actually doing. A console
// that is never read from means the app can only ever display what it last
// sent, which is a guess the moment anyone touches the desk itself.
//
// The X-Air remote protocol makes reading possible, with two mechanisms:
//   * Send an address with NO arguments and the desk replies with its current
//     value.
//   * Send `/xremote` (also argument-less) and the desk pushes every parameter
//     change to you for about ten seconds. It has to be re-sent to stay
//     subscribed.
// Both replies go to the SOURCE port of the request, which is the whole reason
// this class exists: a fire-and-forget socket per message gets a fresh
// ephemeral port every time and the answers land nowhere.
//
// So: one socket for the process's lifetime, one background thread that keeps
// the subscription alive, sweeps the parameters we care about, and decodes
// whatever comes back into a cache. Sends go out on the same socket.
//
// The addresses themselves live in x18_addresses.hpp — socket-free so they can
// be unit-tested, which is where the risk in this feature actually sits.
// ============================================================================
#pragma once

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include <nlohmann/json.hpp>

#include "liveplay/net/x18_addresses.hpp"

namespace liveplay::net {

class X18Link {
public:
    // One per process. The console is a single shared resource and the reply
    // port has to be stable, so a second link would fight the first for the
    // desk's attention.
    static X18Link& instance();

    // Point at a console, or pass an empty string to disconnect. Changing the
    // IP drops the cached values — they described a different desk.
    void configure(const std::string& ip);

    // Current console IP, or empty when unconfigured.
    std::string console_ip() const;

    // Set one parameter. The cache is updated optimistically so a UI that
    // asked for the change sees it immediately rather than a round-trip later;
    // the desk's own echo confirms or corrects it.
    bool send_float(const std::string& address, float value);
    bool send_int(const std::string& address, std::int32_t value);

    // { connected, ip, values: { "<address>": <float> } } — everything the desk
    // has told us. Absent addresses simply have not been answered yet.
    nlohmann::json snapshot() const;

    // Called with { "<address>": <float>, … } whenever values change, from the
    // link's own thread. Keep the callback cheap and non-blocking.
    void set_change_handler(std::function<void(const nlohmann::json&)> fn);

    // Idempotent; also runs from the destructor.
    void stop();

    X18Link(const X18Link&) = delete;
    X18Link& operator=(const X18Link&) = delete;

private:
    X18Link();
    ~X18Link();

    void run();                       // background thread body
    void open_socket_locked();
    void close_socket_locked();
    bool send_raw(const std::vector<char>& packet);
    void note_value(const std::string& address, float value);
    void flush_changes();

    mutable std::mutex        mutex_;
    std::condition_variable   wake_;
    std::thread               thread_;
    std::atomic<bool>         running_{false};

    std::string               ip_;
    std::intptr_t             sock_ = -1;    // socket_t, kept opaque in the header
    bool                      socket_ready_ = false;

    std::unordered_map<std::string, float> values_;
    std::unordered_map<std::string, float> pending_changes_;
    std::function<void(const nlohmann::json&)> on_change_;

    // Index of the next address in the refresh sweep, so a full pass is spread
    // over many wake-ups instead of arriving as one burst the console has to
    // absorb.
    std::size_t               sweep_pos_ = 0;
    bool                      resweep_ = false;
};

} // namespace liveplay::net
