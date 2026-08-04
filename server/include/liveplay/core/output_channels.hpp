// ============================================================================
// liveplay/core/output_channels.hpp
// ----------------------------------------------------------------------------
// Hardware output-channel selection for a device routing.
//
// Every output the project can address — the default output, the preview
// output, the LTC output, a per-cue device override — carries an optional pair
// of 0-based hardware channel indices alongside the device name. Before this
// existed LivePlay always wired the first stereo pair, so an absent or
// malformed selection deliberately falls back to {0, 1}: old projects keep
// playing out of hardware channels 1/2 exactly as they did.
//
// The document stores 0-based indices because that is what
// AudioEngine::assign_master_to_device() takes. The UI renders them 1-based,
// which is how outputs are labelled on the hardware (an X18's USB return 1
// is hw_channel 0).
//
// Header-only and dependency-light (json + audio types) so the parsing rules
// are unit-testable without linking the engine.
// ============================================================================
#pragma once

#include "liveplay/audio/types.hpp"

#include <cmath>
#include <nlohmann/json.hpp>
#include <optional>
#include <string>

namespace liveplay::core {

// ---------------------------------------------------------------------------
// A pair of 0-based hardware output channels on one device.
//
// `left == right` means the routing is *mono*: a single master channel feeding
// a single hardware channel. That distinction matters — the render loop sums
// every master assigned to the same (device, hw_channel), so modelling mono as
// a degenerate stereo pair would double the signal (+6 dB).
// ---------------------------------------------------------------------------
struct OutputChannelPair {
    audio::ChannelIndex left  = 0;
    audio::ChannelIndex right = 1;

    [[nodiscard]] bool mono() const noexcept { return left == right; }

    // Highest hardware channel this pair touches — i.e. the minimum number of
    // output channels the device must be opened with for both to be audible.
    [[nodiscard]] audio::ChannelIndex highest() const noexcept {
        return left > right ? left : right;
    }

    friend bool operator==(const OutputChannelPair& a,
                           const OutputChannelPair& b) noexcept {
        return a.left == b.left && a.right == b.right;
    }
    friend bool operator!=(const OutputChannelPair& a,
                           const OutputChannelPair& b) noexcept {
        return !(a == b);
    }
};

// The pair LivePlay wired unconditionally before channel selection existed.
inline constexpr OutputChannelPair kDefaultOutputChannels{0, 1};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------
// Read a single 0-based hardware channel index. Numbers are rounded (a client
// that sends 4.0 means channel index 4) and negatives rejected. Returns
// nullopt when the value is absent or unusable so callers can tell "not
// configured" apart from an explicit choice of channel 0.
inline std::optional<audio::ChannelIndex>
parse_output_channel(const nlohmann::json& v) {
    if (!v.is_number()) return std::nullopt;
    const double d = v.get<double>();
    if (!std::isfinite(d) || d < 0.0) return std::nullopt;
    return static_cast<audio::ChannelIndex>(std::llround(d));
}

// Read a `[left, right]` pair as stored in the project document. Anything that
// isn't a 2-element array of non-negative numbers yields `fallback`, so a
// corrupt document degrades to the historical stereo pair rather than to
// silence on an out-of-range channel.
inline OutputChannelPair
parse_output_channel_pair(const nlohmann::json& v,
                          OutputChannelPair fallback = kDefaultOutputChannels) {
    if (!v.is_array() || v.size() != 2) return fallback;
    const auto l = parse_output_channel(v[0]);
    const auto r = parse_output_channel(v[1]);
    if (!l || !r) return fallback;
    return OutputChannelPair{*l, *r};
}

// Look up `key` in a settings/item object and parse it as a channel pair.
inline OutputChannelPair
output_channel_pair_setting(const nlohmann::json& obj,
                            const std::string& key,
                            OutputChannelPair fallback = kDefaultOutputChannels) {
    if (!obj.is_object()) return fallback;
    const auto it = obj.find(key);
    if (it == obj.end()) return fallback;
    return parse_output_channel_pair(*it, fallback);
}

// Look up `key` in a settings object and parse it as a single channel index.
inline std::optional<audio::ChannelIndex>
output_channel_setting(const nlohmann::json& obj, const std::string& key) {
    if (!obj.is_object()) return std::nullopt;
    const auto it = obj.find(key);
    if (it == obj.end()) return std::nullopt;
    return parse_output_channel(*it);
}

// ---------------------------------------------------------------------------
// Routing identity
// ---------------------------------------------------------------------------
// Identity of a device routing: one mixer + one master allocation per
// (device, channel pair). Two cues that both want "X18" channels 5/6 share a
// routing; a third that wants 7/8 on the same device gets its own. The
// separator is ASCII US (0x1f) so it can't collide with a device name.
inline std::string device_routing_key(const std::string& device_name,
                                      OutputChannelPair ch) {
    return device_name + '\x1f' + std::to_string(ch.left)
                       + '/'    + std::to_string(ch.right);
}

// Human-readable mixer name for a device routing. 1-based, because that's how
// the outputs are numbered on the hardware.
inline std::string device_routing_label(const std::string& device_name,
                                        OutputChannelPair ch) {
    std::string out = "Output: " + device_name + " (ch " + std::to_string(ch.left + 1);
    if (!ch.mono()) out += '/' + std::to_string(ch.right + 1);
    return out + ')';
}

} // namespace liveplay::core
