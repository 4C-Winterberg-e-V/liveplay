// Unit tests for the filesystem sandbox (server/src/util/fs_sandbox.cpp) — the
// server's sole defence against path-traversal / arbitrary-file access over its
// HTTP surface. These pin the security-critical containment behaviour, including
// the component-wise match that must reject a prefix-sibling of a root.
#include <doctest/doctest.h>

#include "liveplay/util/fs_sandbox.hpp"
#include "liveplay/util/unicode_path.hpp"

#include <filesystem>
#include <string>

using namespace liveplay::util;
namespace fs = std::filesystem;

TEST_CASE("FsSandbox confines paths to allowed roots") {
    FsSandbox sandbox;

    // A real, fully-resolved temp directory as the dynamic project root, so the
    // stored root and any canonicalised candidate agree on macOS (/var -> /private/var).
    fs::path base = fs::temp_directory_path() / "liveplay_fs_sandbox_test";
    fs::create_directories(base);
    base = fs::canonical(base);
    sandbox.set_project_root(base);

    SUBCASE("paths inside the project root are allowed") {
        CHECK(sandbox.is_within_roots(base / "song.wav"));
        CHECK(sandbox.is_within_roots(base / "sub" / "deep.wav"));
        CHECK(sandbox.authorize(path_to_utf8(base / "media.wav")).has_value());
    }

    SUBCASE("a prefix-sibling of a root is NOT inside it (component-wise match)") {
        const fs::path sibling = base.parent_path() / (base.filename().string() + "-evil");
        CHECK_FALSE(sandbox.is_within_roots(sibling / "loot.wav"));
    }

    SUBCASE("a '..' traversal escaping the root is refused") {
        const std::string escape = path_to_utf8(base) + "/../escape_me.wav";
        CHECK_FALSE(sandbox.authorize(escape).has_value());
    }

    SUBCASE("empty input is refused (computer-root listing is the caller's job)") {
        CHECK_FALSE(sandbox.authorize("").has_value());
    }

    std::error_code ec;
    fs::remove_all(base, ec);
}
