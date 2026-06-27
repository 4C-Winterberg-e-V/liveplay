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

#if defined(_WIN32)
// Process-lifetime Winsock init. DiscoveryBeacon owns the same guard pattern;
// WSAStartup is refcounted so initialising twice is harmless.
struct WsaGuard {
    bool ok = false;
    WsaGuard()  { WSADATA d{}; ok = (WSAStartup(MAKEWORD(2, 2), &d) == 0); }
    ~WsaGuard() { if (ok) WSACleanup(); }
};
#endif

// Send a fully-built OSC packet to host:port over UDP. Shared by the float
// and int senders. Returns true if the datagram was handed to the socket.
bool osc_send_packet(const std::string& host, std::uint16_t port,
                     const std::string& address, const std::vector<char>& pkt) {
    if (host.empty() || address.empty()) return false;

#if defined(_WIN32)
    static WsaGuard g;
    (void)g;
#endif

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
    return true;
}

} // namespace

bool osc_send_float(const std::string& host, std::uint16_t port,
                    const std::string& address, float value) {
    // Encoding (osc_build_float) is header-only + unit-tested; here we just send.
    if (!osc_send_packet(host, port, address, osc_build_float(address, value)))
        return false;
    Logger::info("OSC -> {}:{}  {} {:.3f}", host, port, address, value);
    return true;
}

bool osc_send_int(const std::string& host, std::uint16_t port,
                  const std::string& address, std::int32_t value) {
    if (!osc_send_packet(host, port, address, osc_build_int(address, value)))
        return false;
    Logger::info("OSC -> {}:{}  {} {}", host, port, address, value);
    return true;
}

} // namespace liveplay::net
