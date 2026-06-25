// ============================================================================
// osc_client.cpp — see osc_client.hpp.
// ============================================================================
#include "liveplay/net/osc_client.hpp"
#include "liveplay/logger.hpp"

#include <cstring>
#include <vector>

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

// Append an OSC string: the raw bytes, then at least one NUL terminator, then
// padding NULs so the total length is a multiple of 4 bytes (OSC spec 1.0).
void osc_append_string(std::vector<char>& buf, const std::string& s) {
    buf.insert(buf.end(), s.begin(), s.end());
    // Always at least one NUL, then pad to the next 4-byte boundary.
    do { buf.push_back('\0'); } while (buf.size() % 4 != 0);
}

#if defined(_WIN32)
// Process-lifetime Winsock init. DiscoveryBeacon owns the same guard pattern;
// WSAStartup is refcounted so initialising twice is harmless.
struct WsaGuard {
    bool ok = false;
    WsaGuard()  { WSADATA d{}; ok = (WSAStartup(MAKEWORD(2, 2), &d) == 0); }
    ~WsaGuard() { if (ok) WSACleanup(); }
};
#endif

} // namespace

bool osc_send_float(const std::string& host, std::uint16_t port,
                    const std::string& address, float value) {
    if (host.empty() || address.empty()) return false;

#if defined(_WIN32)
    static WsaGuard g;
    (void)g;
#endif

    // ---- Build the OSC packet: <address> <",f"> <float big-endian> --------
    std::vector<char> pkt;
    pkt.reserve(address.size() + 16);
    osc_append_string(pkt, address);
    osc_append_string(pkt, ",f");

    // OSC floats are 32-bit IEEE-754, big-endian (network byte order).
    std::uint32_t raw;
    std::memcpy(&raw, &value, sizeof(raw));
    const std::uint32_t be = htonl(raw);
    const char* be_bytes = reinterpret_cast<const char*>(&be);
    pkt.insert(pkt.end(), be_bytes, be_bytes + 4);

    // ---- Resolve destination (numeric IPv4 only) -------------------------
    sockaddr_in dest{};
    dest.sin_family = AF_INET;
    dest.sin_port   = htons(port);
    if (inet_pton(AF_INET, host.c_str(), &dest.sin_addr) != 1) {
        Logger::warn("OSC: invalid X18 IP address '{}'", host);
        return false;
    }

    socket_t sock = ::socket(AF_INET, SOCK_DGRAM, 0);
    if (sock == LP_INVALID_SOCKET) {
        Logger::warn("OSC: socket() failed; cannot reach X18 at {}", host);
        return false;
    }

    const auto n = ::sendto(sock, pkt.data(), static_cast<int>(pkt.size()), 0,
                            reinterpret_cast<sockaddr*>(&dest), sizeof(dest));
    LP_CLOSE_SOCKET(sock);

    if (n < 0) {
        Logger::warn("OSC: sendto({}:{}) failed for '{}'", host, port, address);
        return false;
    }
    Logger::info("OSC -> {}:{}  {} {:.3f}", host, port, address, value);
    return true;
}

} // namespace liveplay::net
