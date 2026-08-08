// ============================================================================
// liveplay/net/x18_fader_law.hpp
// ----------------------------------------------------------------------------
// The X32 / X-Air fader taper: console fader position (0.0-1.0, which is what
// the OSC argument carries) <-> dB, which is what an operator thinks in.
//
// Needed here because a RELATIVE level change is stated in dB — "six down for
// the announcement" — while the wire only speaks position, and the curve
// between them is not linear. Six dB off a channel sitting near unity is a very
// different distance along the fader than six dB off one already down at -40.
//
// Header-only and dependency-free for the same reason the OSC encoders are: the
// curve is the part that is easy to get subtly wrong, and it can be pinned by a
// unit test without a socket (tests/test_x18_link.cpp).
//
// This mirrors client/app/utils/x18Fader.ts. The two must agree: the phone
// prints the dB the desk is at, and the server computes the dB a button moves
// it by. Both files' tests assert the same anchor points.
//
// The taper is piecewise linear in POSITION, with the segments meeting at
// pos .5 = -10 dB, .25 = -30 dB, .0625 = -60 dB, and unity (0 dB) at .75.
// ============================================================================
#pragma once

#include <cmath>
#include <limits>

namespace liveplay::net {

/** Fader position of unity gain. */
inline constexpr float kX18UnityPos = 0.75f;
/** Top of the taper. */
inline constexpr float kX18MaxDb = 10.0f;
/** Bottom of the taper. Below this the console is simply off. */
inline constexpr float kX18MinDb = -90.0f;

inline float x18_clamp_pos(float pos) {
    if (!std::isfinite(pos)) return 0.0f;
    return pos < 0.0f ? 0.0f : (pos > 1.0f ? 1.0f : pos);
}

/** Position -> dB. A closed fader is -infinity, not -90: it is off. */
inline float x18_pos_to_db(float pos) {
    const float p = x18_clamp_pos(pos);
    if (p <= 0.0f) return -std::numeric_limits<float>::infinity();
    if (p >= 0.5f)    return 40.0f  * p - 30.0f;   // -10 … +10 dB
    if (p >= 0.25f)   return 80.0f  * p - 50.0f;   // -30 … -10 dB
    if (p >= 0.0625f) return 160.0f * p - 70.0f;   // -60 … -30 dB
    return 480.0f * p - 90.0f;                     // -90 … -60 dB
}

/** dB -> position, saturating at both ends of the taper. */
inline float x18_db_to_pos(float db) {
    if (std::isnan(db)) return 0.0f;
    if (db >= kX18MaxDb) return 1.0f;
    if (db <= kX18MinDb) return 0.0f;              // also catches -infinity
    if (db >= -10.0f) return x18_clamp_pos((db + 30.0f) / 40.0f);
    if (db >= -30.0f) return x18_clamp_pos((db + 50.0f) / 80.0f);
    if (db >= -60.0f) return x18_clamp_pos((db + 70.0f) / 160.0f);
    return x18_clamp_pos((db + 90.0f) / 480.0f);
}

/**
 * Shift a fader position by `delta_db`.
 *
 * A closed fader is treated as sitting at the bottom of the taper rather than
 * at -infinity, so "+3 dB" on a closed channel opens it slightly instead of
 * being a no-op forever. Going the other way, anything that lands at or below
 * the bottom closes the fader outright — which is what the desk does too.
 */
inline float x18_shift_pos_by_db(float pos, float delta_db) {
    if (!std::isfinite(delta_db)) return x18_clamp_pos(pos);
    const float current = x18_pos_to_db(pos);
    const float base = std::isfinite(current) ? current : kX18MinDb;
    const float next = base + delta_db;
    if (next <= kX18MinDb) return 0.0f;
    return x18_db_to_pos(next);
}

} // namespace liveplay::net
