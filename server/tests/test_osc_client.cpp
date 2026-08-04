// Unit tests for the OSC wire encoder (server/include/liveplay/net/osc_client.hpp).
//
// The encoder (osc_build_float / osc_build_int) is header-only and socket-free
// precisely so the byte layout can be pinned here without opening a UDP socket.
// These tests guard the two things that are easy to get subtly wrong and that
// the X18 firmware is strict about: OSC 4-byte NUL-padding of the address and
// type-tag strings, and big-endian (network-order) encoding of the argument.
#include <doctest/doctest.h>

#include "liveplay/net/osc_client.hpp"

#include <cstdint>
#include <string>
#include <vector>

using namespace liveplay::net;

namespace {
// Interpret the packet bytes as an unsigned byte at index i.
std::uint8_t at(const std::vector<char>& p, std::size_t i) {
    return static_cast<std::uint8_t>(p[i]);
}
std::string str(const std::vector<char>& p, std::size_t off, std::size_t n) {
    return std::string(p.data() + off, n);
}
}  // namespace

TEST_CASE("osc_build_float: address + type tag are NUL-padded to 4 bytes") {
    // "/lr/mix/fader" is 13 bytes -> +1 NUL = 14 -> padded to 16.
    // ",f" is 2 bytes -> +1 NUL = 3 -> padded to 4.
    // float arg = 4 bytes. Total = 24.
    const auto p = osc_build_float("/lr/mix/fader", 0.0f);
    REQUIRE(p.size() == 24);
    CHECK(str(p, 0, 13) == "/lr/mix/fader");
    CHECK(at(p, 13) == 0);
    CHECK(at(p, 14) == 0);
    CHECK(at(p, 15) == 0);
    CHECK(str(p, 16, 2) == ",f");
    CHECK(at(p, 18) == 0);
    CHECK(at(p, 19) == 0);
}

TEST_CASE("osc_build_float: value is IEEE-754 big-endian") {
    // 0.5f == 0x3F000000.
    const auto p = osc_build_float("/lr/mix/fader", 0.5f);
    REQUIRE(p.size() == 24);
    CHECK(at(p, 20) == 0x3F);
    CHECK(at(p, 21) == 0x00);
    CHECK(at(p, 22) == 0x00);
    CHECK(at(p, 23) == 0x00);

    // 1.0f == 0x3F800000.
    const auto q = osc_build_float("/lr/mix/fader", 1.0f);
    CHECK(at(q, 20) == 0x3F);
    CHECK(at(q, 21) == 0x80);
    CHECK(at(q, 22) == 0x00);
    CHECK(at(q, 23) == 0x00);
}

TEST_CASE("osc_build_int: type tag and big-endian int payload") {
    // "/config/mute/1" is 14 bytes -> +1 NUL = 15 -> padded to 16.
    // ",i" -> 4 bytes. int -> 4 bytes. Total = 24.
    const auto p = osc_build_int("/config/mute/1", 1);
    REQUIRE(p.size() == 24);
    CHECK(str(p, 0, 14) == "/config/mute/1");
    CHECK(at(p, 14) == 0);
    CHECK(at(p, 15) == 0);
    CHECK(str(p, 16, 2) == ",i");
    // int32 1 big-endian = 00 00 00 01.
    CHECK(at(p, 20) == 0x00);
    CHECK(at(p, 21) == 0x00);
    CHECK(at(p, 22) == 0x00);
    CHECK(at(p, 23) == 0x01);
}

TEST_CASE("osc_build_int: zero (X-Air mute/unmute boundary value)") {
    const auto p = osc_build_int("/ch/03/mix/on", 0);
    REQUIRE(p.size() % 4 == 0);
    CHECK(at(p, p.size() - 1) == 0x00);
}

TEST_CASE("osc strings whose length is already a multiple of 4 still get a NUL pad") {
    // "/ab" is 3 bytes -> +1 NUL = 4 (already aligned, exactly one NUL).
    // "/abc" is 4 bytes -> must still gain a full 4 NUL bytes (OSC requires at
    // least one terminator), so the address block is 8 bytes.
    const auto p = osc_build_int("/abc", 0);
    // address 8 + type tag 4 + int 4 = 16.
    CHECK(p.size() == 16);
    CHECK(str(p, 0, 4) == "/abc");
    CHECK(at(p, 4) == 0);
    CHECK(at(p, 7) == 0);
}
