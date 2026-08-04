// ============================================================================
// liveplay/net/osc_client.hpp
// ----------------------------------------------------------------------------
// Minimal one-shot OSC-over-UDP sender. Used to control external mixing
// consoles that speak OSC — currently the Behringer X18 / XR-series (X-Air),
// whose remote-control protocol listens on UDP/10024.
//
// We deliberately keep this tiny and dependency-free (raw BSD/Winsock
// sockets, same as discovery.cpp) rather than vendoring an OSC library:
//   * The only messages LivePlay sends are single-float fader commands
//     (e.g. /lr/mix/fader 0.0, /ch/03/mix/fader 0.75) and single-int mute
//     toggles (e.g. /ch/03/mix/on 0, /config/mute/1 1).
//   * OSC/UDP is fire-and-forget, so there is no reply to parse.
//
// This is intentionally NOT routed through the http-request external action
// handler (which fans out to a connected client): the X18 is driven directly
// from the LivePlay server so it works even when no UI client is attached.
//
// The wire-encoding helpers (osc_build_float / osc_build_int) are header-only
// and socket-free on purpose, so the OSC byte layout can be unit-tested
// (server/tests/test_osc_client.cpp) without opening a socket.
// ============================================================================
#pragma once

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace liveplay::net {

namespace detail {

// Append an OSC string: the raw bytes, then at least one NUL terminator, then
// padding NULs so the total length is a multiple of 4 bytes (OSC spec 1.0).
inline void osc_append_string(std::vector<char>& buf, const std::string& s) {
    buf.insert(buf.end(), s.begin(), s.end());
    do { buf.push_back('\0'); } while (buf.size() % 4 != 0);
}

// Append a 32-bit big-endian (network byte order) word. Done with explicit
// shifts so the result is correct regardless of host endianness — no htonl,
// which keeps this header free of <winsock2.h>/<arpa/inet.h>.
inline void osc_append_be32(std::vector<char>& buf, std::uint32_t v) {
    buf.push_back(static_cast<char>((v >> 24) & 0xFF));
    buf.push_back(static_cast<char>((v >> 16) & 0xFF));
    buf.push_back(static_cast<char>((v >> 8)  & 0xFF));
    buf.push_back(static_cast<char>( v        & 0xFF));
}

} // namespace detail

// Build the raw OSC datagram for a single-float message (type tag ",f").
inline std::vector<char> osc_build_float(const std::string& address, float value) {
    std::vector<char> pkt;
    detail::osc_append_string(pkt, address);
    detail::osc_append_string(pkt, ",f");
    std::uint32_t raw;
    std::memcpy(&raw, &value, sizeof(raw));  // reinterpret float bits as uint32
    detail::osc_append_be32(pkt, raw);
    return pkt;
}

// Build the raw OSC datagram for a single-int message (type tag ",i").
inline std::vector<char> osc_build_int(const std::string& address, std::int32_t value) {
    std::vector<char> pkt;
    detail::osc_append_string(pkt, address);
    detail::osc_append_string(pkt, ",i");
    detail::osc_append_be32(pkt, static_cast<std::uint32_t>(value));
    return pkt;
}

// Send a single OSC message carrying one 32-bit float argument to host:port
// over UDP. `host` must be a numeric IPv4 address (e.g. "192.168.1.50") —
// the user enters the console's IP in project settings, so no DNS resolution
// is attempted. `address` is the OSC address pattern (e.g. "/lr/mix/fader").
//
// Returns true if the datagram was handed to the socket. Best-effort:
// OSC/UDP is connectionless, so a true return does not guarantee the console
// received it.
bool osc_send_float(const std::string& host, std::uint16_t port,
                    const std::string& address, float value);

// As osc_send_float but sends a single 32-bit integer argument (OSC ",i").
// The X-Air console expects ints (not floats) for on/off-style parameters
// such as channel/bus mute (/…/mix/on) and mute groups (/config/mute/N).
bool osc_send_int(const std::string& host, std::uint16_t port,
                  const std::string& address, std::int32_t value);

} // namespace liveplay::net
