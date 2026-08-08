// ============================================================================
// X-Air OSC address construction and message decoding.
//
// These two things carry the risk in the console-sync feature. An address that
// is one character off addresses nothing (or, worse, the wrong bus) and fails
// silently, because OSC/UDP never answers back. A decoder that mis-reads a
// reply shows the operator a level the desk is not at. Neither needs a socket
// to test, which is why both live in headers.
// ============================================================================
#include <doctest/doctest.h>

#include "liveplay/net/osc_client.hpp"
#include "liveplay/net/x18_addresses.hpp"

#include <algorithm>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

using namespace liveplay::net;

TEST_CASE("x18_channel_mix_address matches the published X-Air addresses") {
    // Main mix: a channel's level IS its fader.
    CHECK(x18_channel_mix_address(1, kX18MainMix)  == "/ch/01/mix/fader");
    CHECK(x18_channel_mix_address(16, kX18MainMix) == "/ch/16/mix/fader");

    // Bus sends carry the mix index, zero-padded like the channel.
    CHECK(x18_channel_mix_address(1, 1)  == "/ch/01/mix/01/level");
    CHECK(x18_channel_mix_address(3, 2)  == "/ch/03/mix/02/level");
    CHECK(x18_channel_mix_address(16, 6) == "/ch/16/mix/06/level");
}

TEST_CASE("x18_channel_mix_address rejects anything off the desk") {
    // Returning empty is what lets the caller drop the command. Clamping into
    // range would send a real level to a real speaker that nobody asked for.
    CHECK(x18_channel_mix_address(0, 1).empty());
    CHECK(x18_channel_mix_address(17, 1).empty());
    CHECK(x18_channel_mix_address(-1, 0).empty());
    CHECK(x18_channel_mix_address(1, 7).empty());     // 7-10 are the FX sends
    CHECK(x18_channel_mix_address(1, -1).empty());
}

TEST_CASE("x18_mix_master_address uses the console's own padding") {
    // Deliberately inconsistent on the desk: bus masters are single-digit
    // while channels and send indices are two.
    CHECK(x18_mix_master_address(kX18MainMix) == "/lr/mix/fader");
    CHECK(x18_mix_master_address(1) == "/bus/1/mix/fader");
    CHECK(x18_mix_master_address(6) == "/bus/6/mix/fader");
    CHECK(x18_mix_master_address(7).empty());
    CHECK(x18_mix_master_address(-1).empty());
}

TEST_CASE("x18_watched_addresses covers every mix and channel exactly once") {
    const auto& all = x18_watched_addresses();
    CHECK(all.size() == static_cast<std::size_t>((kX18Buses + 1) * (kX18Channels + 1)));

    // No duplicates: a repeated address means a wasted query every sweep.
    auto sorted = all;
    std::sort(sorted.begin(), sorted.end());
    CHECK(std::adjacent_find(sorted.begin(), sorted.end()) == sorted.end());

    // No empties: an empty string would be sent as a malformed OSC packet.
    for (const auto& a : all) {
        CHECK_FALSE(a.empty());
        CHECK(a[0] == '/');
    }

    auto has = [&](const std::string& a) {
        return std::find(all.begin(), all.end(), a) != all.end();
    };
    CHECK(has("/lr/mix/fader"));
    CHECK(has("/bus/6/mix/fader"));
    CHECK(has("/ch/01/mix/fader"));
    CHECK(has("/ch/16/mix/06/level"));
}

TEST_CASE("osc_build_query is a bare address with an empty type tag") {
    const auto pkt = osc_build_query("/xremote");
    // "/xremote" is 8 chars + NUL = 9 -> padded to 12; "," + NUL = 2 -> 4.
    REQUIRE(pkt.size() == 16);
    CHECK(std::memcmp(pkt.data(), "/xremote\0\0\0\0", 12) == 0);
    CHECK(std::memcmp(pkt.data() + 12, ",\0\0\0", 4) == 0);
}

TEST_CASE("osc_parse_message round-trips what we build") {
    SUBCASE("float") {
        const auto pkt = osc_build_float("/ch/01/mix/01/level", 0.75f);
        OscMessage m;
        REQUIRE(osc_parse_message(pkt.data(), pkt.size(), m));
        CHECK(m.address == "/ch/01/mix/01/level");
        CHECK(m.type == 'f');
        CHECK(m.f == doctest::Approx(0.75f));
    }
    SUBCASE("int") {
        const auto pkt = osc_build_int("/ch/03/mix/on", 1);
        OscMessage m;
        REQUIRE(osc_parse_message(pkt.data(), pkt.size(), m));
        CHECK(m.address == "/ch/03/mix/on");
        CHECK(m.type == 'i');
        CHECK(m.i == 1);
    }
    SUBCASE("query carries no argument") {
        const auto pkt = osc_build_query("/lr/mix/fader");
        OscMessage m;
        REQUIRE(osc_parse_message(pkt.data(), pkt.size(), m));
        CHECK(m.address == "/lr/mix/fader");
        CHECK(m.type == '\0');
    }
}

TEST_CASE("osc_parse_message decodes a string argument") {
    // The desk answers /ch/01/config/name with a string. We do not act on those
    // yet, but mis-parsing one must not corrupt the address of the next.
    std::vector<char> pkt;
    liveplay::net::detail::osc_append_string(pkt, "/ch/01/config/name");
    liveplay::net::detail::osc_append_string(pkt, ",s");
    liveplay::net::detail::osc_append_string(pkt, "Vocal");
    OscMessage m;
    REQUIRE(osc_parse_message(pkt.data(), pkt.size(), m));
    CHECK(m.address == "/ch/01/config/name");
    CHECK(m.type == 's');
    CHECK(m.s == "Vocal");
}

TEST_CASE("osc_parse_message refuses malformed input rather than reading past it") {
    OscMessage m;
    CHECK_FALSE(osc_parse_message(nullptr, 0, m));
    CHECK_FALSE(osc_parse_message("", 0, m));

    // Not an address.
    const char not_address[] = "hello\0\0\0";
    CHECK_FALSE(osc_parse_message(not_address, sizeof(not_address) - 1, m));

    // Address with no NUL terminator anywhere in the buffer — the case that
    // would run a naive reader off the end of a datagram from the network.
    const char unterminated[] = {'/', 'c', 'h', '0', '1', '/', 'm', 'i'};
    CHECK_FALSE(osc_parse_message(unterminated, sizeof(unterminated), m));

    // Type tag claims a float but the argument bytes are missing.
    std::vector<char> truncated;
    liveplay::net::detail::osc_append_string(truncated, "/lr/mix/fader");
    liveplay::net::detail::osc_append_string(truncated, ",f");
    CHECK_FALSE(osc_parse_message(truncated.data(), truncated.size(), m));

    // Type tag that does not start with a comma is not a type tag.
    std::vector<char> bad_tag;
    liveplay::net::detail::osc_append_string(bad_tag, "/lr/mix/fader");
    liveplay::net::detail::osc_append_string(bad_tag, "f");
    CHECK_FALSE(osc_parse_message(bad_tag.data(), bad_tag.size(), m));
}

TEST_CASE("osc_parse_message survives an argument type we do not decode") {
    // A blob argument: the address is still useful, the value is not ours.
    std::vector<char> pkt;
    liveplay::net::detail::osc_append_string(pkt, "/meters/1");
    liveplay::net::detail::osc_append_string(pkt, ",b");
    OscMessage m;
    REQUIRE(osc_parse_message(pkt.data(), pkt.size(), m));
    CHECK(m.address == "/meters/1");
    CHECK(m.type == '\0');
}

TEST_CASE("osc_for_each_message unpacks a bundle") {
    const auto a = osc_build_float("/ch/01/mix/fader", 0.5f);
    const auto b = osc_build_float("/bus/2/mix/fader", 0.25f);

    std::vector<char> bundle;
    liveplay::net::detail::osc_append_string(bundle, "#bundle");
    for (int i = 0; i < 8; ++i) bundle.push_back('\0');          // timetag
    liveplay::net::detail::osc_append_be32(bundle, static_cast<std::uint32_t>(a.size()));
    bundle.insert(bundle.end(), a.begin(), a.end());
    liveplay::net::detail::osc_append_be32(bundle, static_cast<std::uint32_t>(b.size()));
    bundle.insert(bundle.end(), b.begin(), b.end());

    std::vector<std::pair<std::string, float>> seen;
    osc_for_each_message(bundle.data(), bundle.size(), [&](const OscMessage& m) {
        seen.emplace_back(m.address, m.f);
    });
    REQUIRE(seen.size() == 2);
    CHECK(seen[0].first == "/ch/01/mix/fader");
    CHECK(seen[0].second == doctest::Approx(0.5f));
    CHECK(seen[1].first == "/bus/2/mix/fader");
    CHECK(seen[1].second == doctest::Approx(0.25f));
}

TEST_CASE("osc_for_each_message stops on a bundle that lies about its sizes") {
    std::vector<char> bundle;
    liveplay::net::detail::osc_append_string(bundle, "#bundle");
    for (int i = 0; i < 8; ++i) bundle.push_back('\0');
    liveplay::net::detail::osc_append_be32(bundle, 9999);         // longer than the buffer
    const auto a = osc_build_float("/ch/01/mix/fader", 0.5f);
    bundle.insert(bundle.end(), a.begin(), a.end());

    int calls = 0;
    osc_for_each_message(bundle.data(), bundle.size(), [&](const OscMessage&) { ++calls; });
    CHECK(calls == 0);
}

TEST_CASE("osc_for_each_message passes a plain message straight through") {
    const auto pkt = osc_build_float("/lr/mix/fader", 1.0f);
    int calls = 0;
    osc_for_each_message(pkt.data(), pkt.size(), [&](const OscMessage& m) {
        ++calls;
        CHECK(m.address == "/lr/mix/fader");
        CHECK(m.f == doctest::Approx(1.0f));
    });
    CHECK(calls == 1);
}
