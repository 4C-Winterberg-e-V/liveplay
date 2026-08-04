// Unit tests for hardware output-channel selection
// (server/include/liveplay/core/output_channels.hpp).
//
// The header is dependency-light on purpose so these rules can be pinned
// without linking the engine. Two of them carry real operator consequences and
// are easy to regress:
//   * An absent or malformed selection MUST fall back to hardware channels
//     0/1. That is what LivePlay wired unconditionally before channel
//     selection existed, so every pre-existing project has no selection stored
//     and must keep playing out of the first stereo pair.
//   * left == right means mono. ProjectState wires such a routing through a
//     single master channel, because the render loop sums every master landing
//     on the same hardware channel — a "stereo" pair pointed at one channel
//     would play the signal at +6 dB.
#include <doctest/doctest.h>

#include "liveplay/core/output_channels.hpp"

#include <nlohmann/json.hpp>
#include <string>

using namespace liveplay::core;
using json = nlohmann::json;

TEST_CASE("kDefaultOutputChannels is the historical stereo pair") {
    CHECK(kDefaultOutputChannels.left  == 0);
    CHECK(kDefaultOutputChannels.right == 1);
    CHECK_FALSE(kDefaultOutputChannels.mono());
    // A default-constructed pair must match it — ProjectState relies on
    // `OutputChannelPair{}` meaning "as before".
    CHECK(OutputChannelPair{} == kDefaultOutputChannels);
}

TEST_CASE("OutputChannelPair: mono and highest") {
    CHECK(OutputChannelPair{4, 4}.mono());
    CHECK_FALSE(OutputChannelPair{4, 5}.mono());

    // highest() drives both the "device must be opened with N channels" check
    // and the out-of-range warning, so it must not assume left < right.
    CHECK(OutputChannelPair{4, 5}.highest() == 5);
    CHECK(OutputChannelPair{5, 4}.highest() == 5);
    CHECK(OutputChannelPair{7, 7}.highest() == 7);
    CHECK(OutputChannelPair{0, 1}.highest() == 1);
}

TEST_CASE("parse_output_channel: accepts usable indices, rejects the rest") {
    CHECK(parse_output_channel(json(0)).value()  == 0);
    CHECK(parse_output_channel(json(17)).value() == 17);
    // A client that serialises the index as a float still means that channel.
    CHECK(parse_output_channel(json(4.0)).value() == 4);
    CHECK(parse_output_channel(json(4.6)).value() == 5);   // rounds

    CHECK_FALSE(parse_output_channel(json(-1)).has_value());
    CHECK_FALSE(parse_output_channel(json("2")).has_value());
    CHECK_FALSE(parse_output_channel(json(nullptr)).has_value());
    CHECK_FALSE(parse_output_channel(json::array({1})).has_value());
    CHECK_FALSE(parse_output_channel(json::object()).has_value());
    CHECK_FALSE(parse_output_channel(json(true)).has_value());
}

TEST_CASE("parse_output_channel_pair: a well-formed pair is taken verbatim") {
    const auto p = parse_output_channel_pair(json::array({4, 5}));
    CHECK(p.left  == 4);
    CHECK(p.right == 5);
}

TEST_CASE("parse_output_channel_pair: a single channel twice is mono") {
    const auto p = parse_output_channel_pair(json::array({6, 6}));
    CHECK(p.left  == 6);
    CHECK(p.right == 6);
    CHECK(p.mono());
}

TEST_CASE("parse_output_channel_pair: anything unusable falls back to 0/1") {
    // Each of these is a shape a hand-edited or older project could contain.
    // None of them may produce a channel index we'd then route audio into.
    const json bad[] = {
        json(nullptr),
        json(3),                          // not a pair
        json("4,5"),
        json::object(),
        json::array({}),                  // wrong arity
        json::array({4}),
        json::array({4, 5, 6}),
        json::array({-1, 2}),             // negative index
        json::array({2, -1}),
        json::array({"4", "5"}),          // strings
        json::array({4, nullptr}),
    };
    for (const auto& v : bad) {
        CAPTURE(v.dump());
        CHECK(parse_output_channel_pair(v) == kDefaultOutputChannels);
    }
}

TEST_CASE("parse_output_channel_pair: an explicit fallback is honoured") {
    const OutputChannelPair fb{8, 9};
    CHECK(parse_output_channel_pair(json(nullptr), fb) == fb);
    CHECK(parse_output_channel_pair(json::array({0, 1}), fb) == kDefaultOutputChannels);
}

TEST_CASE("output_channel_pair_setting: reads the key, tolerates the rest") {
    const json settings = {
        {"defaultOutputDevice",   "X18"},
        {"defaultOutputChannels", json::array({4, 5})},
    };
    const auto p = output_channel_pair_setting(settings, "defaultOutputChannels");
    CHECK(p.left  == 4);
    CHECK(p.right == 5);

    // Missing key, and a settings blob that isn't even an object, both mean
    // "not configured" — never a hard failure.
    CHECK(output_channel_pair_setting(settings, "previewChannels")
              == kDefaultOutputChannels);
    CHECK(output_channel_pair_setting(json(nullptr), "previewChannels")
              == kDefaultOutputChannels);
}

TEST_CASE("output_channel_setting: single channel lookup") {
    const json settings = {{"ltcChannel", 7}};
    CHECK(output_channel_setting(settings, "ltcChannel").value() == 7);
    CHECK_FALSE(output_channel_setting(settings, "missing").has_value());
    CHECK_FALSE(output_channel_setting(json::array({7}), "ltcChannel").has_value());

    // Channel 0 must be distinguishable from "not configured": ProjectState
    // uses the empty optional to keep the legacy stereo LTC behaviour.
    const json zero = {{"ltcChannel", 0}};
    REQUIRE(output_channel_setting(zero, "ltcChannel").has_value());
    CHECK(output_channel_setting(zero, "ltcChannel").value() == 0);
}

TEST_CASE("device_routing_key: one routing per (device, channel pair)") {
    const std::string dev = "X18";
    // Same device, different channels → different routings.
    CHECK(device_routing_key(dev, {0, 1}) != device_routing_key(dev, {4, 5}));
    // Same device, same channels → the routing is shared.
    CHECK(device_routing_key(dev, {4, 5}) == device_routing_key(dev, {4, 5}));
    // Different devices on the same channels stay separate.
    CHECK(device_routing_key("X18", {4, 5}) != device_routing_key("X32", {4, 5}));
    // Channel order is part of the identity (swapped L/R is a real routing).
    CHECK(device_routing_key(dev, {4, 5}) != device_routing_key(dev, {5, 4}));
    // A device name that looks like a key suffix must not collide with a
    // shorter name plus channels.
    CHECK(device_routing_key("X18 0/1", {0, 1}) != device_routing_key("X18", {0, 1}));
}

TEST_CASE("device_routing_label: 1-based, mono collapses to one channel") {
    // Labels are what the operator sees in the mixer list, and hardware outputs
    // are numbered from 1 — hw_channel 0 is "ch 1".
    CHECK(device_routing_label("X18", {0, 1}) == "Output: X18 (ch 1/2)");
    CHECK(device_routing_label("X18", {4, 5}) == "Output: X18 (ch 5/6)");
    CHECK(device_routing_label("X18", {6, 6}) == "Output: X18 (ch 7)");
}
