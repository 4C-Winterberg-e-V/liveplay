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

// Build a bare OSC message with NO arguments (type tag ","). On X-Air consoles
// this is how you ASK for a parameter: send its address with no argument and
// the desk replies with the current value to your source port. `/xremote` with
// no arguments is the same shape and subscribes to every change for ~10s.
inline std::vector<char> osc_build_query(const std::string& address) {
    std::vector<char> pkt;
    detail::osc_append_string(pkt, address);
    detail::osc_append_string(pkt, ",");
    return pkt;
}

// ---------------------------------------------------------------------------
// Decoding. Header-only for the same reason as the builders: the byte layout
// is the part that is easy to get wrong and worth unit-testing without a
// socket (server/tests/test_osc_client.cpp).
// ---------------------------------------------------------------------------

// One decoded OSC message. `type` is the first argument's tag ('f', 'i' or 's')
// or '\0' when the message carried none — which is what a query looks like.
struct OscMessage {
    std::string  address;
    char         type = '\0';
    float        f = 0.0f;
    std::int32_t i = 0;
    std::string  s;
};

namespace detail {

// Read a NUL-terminated, 4-byte-padded OSC string starting at `pos`. Advances
// `pos` past the padding. Returns false if the string is unterminated.
inline bool osc_read_string(const char* data, std::size_t len,
                            std::size_t& pos, std::string& out) {
    const std::size_t start = pos;
    while (pos < len && data[pos] != '\0') ++pos;
    if (pos >= len) return false;                 // no terminator in the buffer
    out.assign(data + start, pos - start);
    pos = start + ((pos - start) / 4 + 1) * 4;    // skip NUL(s) + padding
    return pos <= len;
}

inline bool osc_read_be32(const char* data, std::size_t len,
                          std::size_t& pos, std::uint32_t& out) {
    if (pos + 4 > len) return false;
    out = (static_cast<std::uint32_t>(static_cast<unsigned char>(data[pos    ])) << 24)
        | (static_cast<std::uint32_t>(static_cast<unsigned char>(data[pos + 1])) << 16)
        | (static_cast<std::uint32_t>(static_cast<unsigned char>(data[pos + 2])) << 8)
        |  static_cast<std::uint32_t>(static_cast<unsigned char>(data[pos + 3]));
    pos += 4;
    return true;
}

} // namespace detail

// Decode a single OSC message. Only the FIRST argument is returned: every
// X-Air parameter we care about is a scalar, and decoding the rest would be
// unused code that still has to be right.
//
// Returns false for anything that is not a well-formed message — including
// bundles, which the caller unpacks (see osc_for_each_message).
inline bool osc_parse_message(const char* data, std::size_t len, OscMessage& out) {
    if (data == nullptr || len < 4 || data[0] != '/') return false;
    std::size_t pos = 0;
    out = OscMessage{};
    if (!detail::osc_read_string(data, len, pos, out.address)) return false;
    if (out.address.empty() || out.address[0] != '/') return false;

    std::string tags;
    if (pos >= len) return true;                       // address only: still valid
    if (!detail::osc_read_string(data, len, pos, tags)) return false;
    if (tags.empty() || tags[0] != ',') return false;
    if (tags.size() < 2) return true;                  // "," — a query, no args

    switch (tags[1]) {
        case 'f': {
            std::uint32_t raw = 0;
            if (!detail::osc_read_be32(data, len, pos, raw)) return false;
            std::memcpy(&out.f, &raw, sizeof(out.f));
            out.type = 'f';
            return true;
        }
        case 'i': {
            std::uint32_t raw = 0;
            if (!detail::osc_read_be32(data, len, pos, raw)) return false;
            out.i = static_cast<std::int32_t>(raw);
            out.type = 'i';
            return true;
        }
        case 's': {
            if (!detail::osc_read_string(data, len, pos, out.s)) return false;
            out.type = 's';
            return true;
        }
        default:
            // A tag we do not decode (blob, timetag, …). The address is still
            // useful to the caller, so report success with type '\0'.
            return true;
    }
}

// Walk a received datagram, calling `fn` for every message in it. A datagram is
// either one message or an OSC bundle ("#bundle" + timetag + length-prefixed
// elements, which may nest). Malformed input stops the walk rather than
// throwing — this runs on data from the network.
template <typename Fn>
inline void osc_for_each_message(const char* data, std::size_t len, Fn&& fn) {
    if (data == nullptr || len < 4) return;
    if (data[0] == '/') {
        OscMessage m;
        if (osc_parse_message(data, len, m)) fn(m);
        return;
    }
    if (len < 16 || std::memcmp(data, "#bundle\0", 8) != 0) return;
    std::size_t pos = 16;                              // "#bundle\0" + timetag
    while (pos + 4 <= len) {
        std::uint32_t size = 0;
        if (!detail::osc_read_be32(data, len, pos, size)) return;
        if (size == 0 || pos + size > len) return;
        osc_for_each_message(data + pos, size, fn);
        pos += size;
    }
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
