// ============================================================================
// liveplay/net/x18_addresses.hpp
// ----------------------------------------------------------------------------
// OSC address construction for the Behringer X-Air family (X18 / XR18 / XR16 /
// XR12), and the list of parameters LivePlay keeps in sync with the desk.
//
// Header-only and socket-free for the same reason osc_client.hpp's encoders
// are: these strings have to match the console byte for byte, that is the part
// which is easy to get subtly wrong, and it can be unit-tested without opening
// a socket (see tests/test_x18_link.cpp).
//
// The zero-padding below is inconsistent — channels and send indices are two
// digits, bus masters are one. That is the console's convention, not a typo;
// writing the shapes out rather than deriving them keeps that visible.
//
//   /lr/mix/fader                  main LR level
//   /bus/<1-6>/mix/fader           bus master level
//   /ch/<01-16>/mix/fader          channel level in the main mix
//   /ch/<01-16>/mix/<01-06>/level  channel's send level into that bus
//
// All are floats 0.0-1.0 on the console's own fader taper. Sources: the X-AIR
// remote-control protocol document, and the address list published at
// behringerwiki.musictribe.com / qlcplus.org's X-Air OSC thread.
//
// Each of those levels also has an on/off switch beside it, which is what
// LivePlay calls mute:
//
//   /lr/mix/on                     main LR on/off
//   /bus/<1-6>/mix/on              bus master on/off
//   /ch/<01-16>/mix/on             channel on/off in the main mix
//   /ch/<01-16>/mix/<01-06>/on     channel's send into that bus, on/off
//
// These are ints, and their sense is INVERTED from the word "mute": the console
// sends 1 for "on" (audible) and 0 for "off" (muted). Getting that backwards
// silences a live channel instead of un-silencing it, so every conversion goes
// through x18_muted_to_on() / x18_on_is_muted() below rather than being written
// out at each call site.
// ============================================================================
#pragma once

#include <cstdio>
#include <string>
#include <unordered_set>
#include <vector>

namespace liveplay::net {

/** Channels on an X18/XR18. */
inline constexpr int kX18Channels = 16;
/** Physical mix buses. Sends 07-10 exist too but are the FX returns. */
inline constexpr int kX18Buses = 6;
/** `bus` value that means "the main LR mix" rather than a numbered bus. */
inline constexpr int kX18MainMix = 0;

namespace detail {
inline std::string x18_pad2(int n) {
    char buf[3];
    std::snprintf(buf, sizeof(buf), "%02d", n);
    return std::string{buf};
}
} // namespace detail

/**
 * Address of a channel's level within one mix.
 * `bus` is kX18MainMix for the main LR mix, or 1-kX18Buses for a send.
 * Returns an empty string for out-of-range input, so a caller can drop the
 * command instead of addressing a channel the desk does not have.
 */
inline std::string x18_channel_mix_address(int channel, int bus) {
    if (channel < 1 || channel > kX18Channels) return {};
    if (bus < 0 || bus > kX18Buses) return {};
    const std::string ch = "/ch/" + detail::x18_pad2(channel);
    // In the main mix a channel's level IS its fader; the bus sends are
    // separate parameters with their own address shape.
    if (bus == kX18MainMix) return ch + "/mix/fader";
    return ch + "/mix/" + detail::x18_pad2(bus) + "/level";
}

/** Address of a mix's own output level: main LR, or a bus master. */
inline std::string x18_mix_master_address(int bus) {
    if (bus < 0 || bus > kX18Buses) return {};
    if (bus == kX18MainMix) return "/lr/mix/fader";
    return "/bus/" + std::to_string(bus) + "/mix/fader";
}

/**
 * On/off switch beside a channel's level in one mix — LivePlay's "mute" for a
 * channel, or for its send into a bus. Same range rules as the level address.
 */
inline std::string x18_channel_mix_on_address(int channel, int bus) {
    if (channel < 1 || channel > kX18Channels) return {};
    if (bus < 0 || bus > kX18Buses) return {};
    const std::string ch = "/ch/" + detail::x18_pad2(channel);
    if (bus == kX18MainMix) return ch + "/mix/on";
    return ch + "/mix/" + detail::x18_pad2(bus) + "/on";
}

/** On/off switch of a mix's own output: main LR, or a bus master. */
inline std::string x18_mix_master_on_address(int bus) {
    if (bus < 0 || bus > kX18Buses) return {};
    if (bus == kX18MainMix) return "/lr/mix/on";
    return "/bus/" + std::to_string(bus) + "/mix/on";
}

/** Console `on` value -> is it muted? 1 = audible, 0 = muted. */
inline bool x18_on_is_muted(float on) { return on < 0.5f; }
/** Muted -> the int to send to a `/…/mix/on` address. */
inline int x18_muted_to_on(bool muted) { return muted ? 0 : 1; }

/**
 * Every address the link keeps fresh: each mix's master plus all 16 channel
 * levels within it, and the on/off switch beside each one. 7 mixes x 17 x 2 =
 * 238 parameters on an X18.
 *
 * Levels and switches are interleaved per strip rather than appended as a
 * second block, because the sweep walks this list in order a few at a time: a
 * strip's level and its mute arrive together, so a fader never sits there
 * knowing its level but not whether it is even audible.
 */
inline const std::vector<std::string>& x18_watched_addresses() {
    static const std::vector<std::string> addresses = [] {
        std::vector<std::string> out;
        out.reserve((kX18Buses + 1) * (kX18Channels + 1) * 2);
        for (int bus = kX18MainMix; bus <= kX18Buses; ++bus) {
            out.push_back(x18_mix_master_address(bus));
            out.push_back(x18_mix_master_on_address(bus));
            for (int ch = 1; ch <= kX18Channels; ++ch) {
                out.push_back(x18_channel_mix_address(ch, bus));
                out.push_back(x18_channel_mix_on_address(ch, bus));
            }
        }
        return out;
    }();
    return addresses;
}

/**
 * Is this an address we asked for? The `/xremote` subscription pushes every
 * parameter change on the desk, most of which are none of our business, so the
 * int decoder uses this to keep the cache to what we actually watch. Floats are
 * let through unfiltered — that predates this and is harmless, since a stray
 * float lands under an address nobody looks up.
 */
inline bool x18_is_watched_address(const std::string& address) {
    static const std::unordered_set<std::string> watched{
        x18_watched_addresses().begin(), x18_watched_addresses().end()};
    return watched.count(address) > 0;
}

} // namespace liveplay::net
