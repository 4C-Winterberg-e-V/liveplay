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
//     (e.g. /lr/mix/fader 0.0, /ch/03/mix/fader 0.75).
//   * OSC/UDP is fire-and-forget, so there is no reply to parse.
//
// This is intentionally NOT routed through the http-request external action
// handler (which fans out to a connected client): the X18 is driven directly
// from the LivePlay server so it works even when no UI client is attached.
// ============================================================================
#pragma once

#include <cstdint>
#include <string>

namespace liveplay::net {

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

} // namespace liveplay::net
