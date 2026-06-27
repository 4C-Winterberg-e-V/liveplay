// ============================================================================
// liveplay/meta/media_limits.hpp
// ----------------------------------------------------------------------------
// Guard against pathological media files before they reach TagLib / miniaudio
// (M-04). Media can be attacker- or accident-supplied (project import, the
// LAN/tunnel-reachable /api/metadata and /api/waveform_path endpoints), so a
// corrupt or absurd file must fail cleanly rather than tie up a worker.
// ============================================================================
#pragma once

#include "liveplay/logger.hpp"
#include "liveplay/util/unicode_path.hpp"

#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <system_error>

namespace liveplay::meta {

// Returns true if `path` is larger than the maximum allowed media size.
//
// Generous default (4 GiB — well beyond any realistic single audio cue; ~6+
// hours of CD-quality stereo WAV) so a normal file is never rejected; raise or
// lower it with the LIVEPLAY_MAX_MEDIA_BYTES environment variable. Fail-open:
// if the size cannot be determined, returns false so a real, readable file is
// never wrongly blocked because of a transient stat error.
inline bool media_file_too_large(const std::filesystem::path& path, const char* who) noexcept {
    std::error_code ec;
    const auto sz = std::filesystem::file_size(path, ec);
    if (ec) return false;  // fail-open — don't block a file we just can't stat

    std::uint64_t limit = 4ull * 1024 * 1024 * 1024;  // 4 GiB
    if (const char* env = std::getenv("LIVEPLAY_MAX_MEDIA_BYTES")) {
        char* end = nullptr;
        const unsigned long long v = std::strtoull(env, &end, 10);
        if (end != env && v > 0) limit = static_cast<std::uint64_t>(v);
    }

    if (static_cast<std::uint64_t>(sz) > limit) {
        Logger::warn("{}: refusing media '{}' — {} bytes exceeds limit {} bytes "
                     "(raise via LIVEPLAY_MAX_MEDIA_BYTES)",
                     who, util::path_to_utf8(path),
                     static_cast<std::uint64_t>(sz), limit);
        return true;
    }
    return false;
}

}  // namespace liveplay::meta
