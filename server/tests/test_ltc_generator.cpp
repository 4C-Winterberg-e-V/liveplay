// Unit tests for the SMPTE LTC generator (server/src/audio/ltc_generator.cpp).
//
// The generator is one of the few self-contained, deterministic pieces of the
// audio engine, which makes it a good first unit-test target. These tests also
// pin the *continuity-across-blocks* property that the H-16 fix relies on: the
// generator itself maintains state between render_block() calls; the bug fixed
// in H-16 lives in the *caller* (playback_item.cpp), which was reconfiguring —
// and thereby resetting — the generator on every block.
#include <doctest/doctest.h>

#include "liveplay/audio/ltc_generator.hpp"

#include <chrono>
#include <cmath>
#include <vector>

using namespace liveplay::audio;
using namespace std::chrono;

namespace {
// Exact nanosecond timestamp for the Nth sample at a given rate.
nanoseconds samples_to_ns(std::size_t samples, SampleRate sr) {
    return nanoseconds{ static_cast<long long>(samples) * 1'000'000'000LL
                        / static_cast<long long>(sr) };
}
}  // namespace

TEST_CASE("frame_rate_value maps each SMPTE rate") {
    CHECK(frame_rate_value(LTCFrameRate::Fps24) == doctest::Approx(24.0));
    CHECK(frame_rate_value(LTCFrameRate::Fps25) == doctest::Approx(25.0));
    CHECK(frame_rate_value(LTCFrameRate::Fps30) == doctest::Approx(30.0));
    CHECK(frame_rate_value(LTCFrameRate::Fps2997_NDF) == doctest::Approx(30000.0 / 1001.0));
    CHECK(frame_rate_value(LTCFrameRate::Fps2997_DF)  == doctest::Approx(30000.0 / 1001.0));
}

TEST_CASE("LTC output is a hard +/- amplitude square wave") {
    LTCGenerator gen;
    const SampleRate sr = 48000;
    const float amp = 0.5f;
    gen.configure(sr, LTCFrameRate::Fps25, nanoseconds{0}, amp);

    std::vector<Sample> buf(1000, 0.0f);
    gen.render_block(buf.data(), buf.size(), nanoseconds{0});

    for (Sample s : buf) {
        CHECK(std::fabs(std::fabs(static_cast<float>(s)) - amp) < 1e-6f);
    }
}

TEST_CASE("negative timecode (offset earlier than playhead) renders silence") {
    LTCGenerator gen;
    gen.configure(48000, LTCFrameRate::Fps25, nanoseconds{-1'000'000'000LL}, 0.5f);
    std::vector<Sample> buf(256, 1.0f);
    gen.render_block(buf.data(), buf.size(), nanoseconds{0});
    for (Sample s : buf) CHECK(s == doctest::Approx(0.0f));
}

TEST_CASE("encoder state is continuous across consecutive render blocks (H-16 property)") {
    const SampleRate sr = 48000;
    const float amp = 0.5f;
    const std::size_t N = 1000;     // stays within frame 0 (1920 samples @ 25fps)
    const std::size_t split = 500;  // a clean mid-frame split point

    // One continuous block.
    LTCGenerator a;
    a.configure(sr, LTCFrameRate::Fps25, nanoseconds{0}, amp);
    std::vector<Sample> whole(N, 0.0f);
    a.render_block(whole.data(), N, nanoseconds{0});

    // The same span rendered as two consecutive blocks, advancing the playhead.
    LTCGenerator b;
    b.configure(sr, LTCFrameRate::Fps25, nanoseconds{0}, amp);
    std::vector<Sample> chunked(N, 0.0f);
    b.render_block(chunked.data(), split, nanoseconds{0});
    b.render_block(chunked.data() + split, N - split, samples_to_ns(split, sr));

    // If the generator relatched/reset between blocks, the boundary would
    // diverge. It must reproduce the continuous render exactly.
    for (std::size_t i = 0; i < N; ++i) {
        CHECK(chunked[i] == doctest::Approx(static_cast<float>(whole[i])));
    }
}
