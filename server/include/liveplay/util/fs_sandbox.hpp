// ============================================================================
// liveplay/util/fs_sandbox.hpp
// ----------------------------------------------------------------------------
// Filesystem sandbox — confines every server-side path operation to a curated
// allow-list of "roots".
//
// Why this exists
// ---------------
// The control server exposes a filesystem surface over HTTP/WebSocket
// (GET /api/fs/list, POST /api/fs/mkdir, /api/copy_to_media, /api/metadata,
// /api/waveform_path, the project load/save/export/import handlers, …). The
// server binds to the LAN (and can be published over a Cloudflare tunnel), so
// any of those endpoints accepting an arbitrary absolute path means *anyone
// who can reach the server can browse and read the whole machine* — a classic
// path-traversal / arbitrary-file-read hole (CWE-22 / CWE-548).
//
// FsSandbox turns that surface from "the entire disk, starting at /" into
// "the user's own media folders plus the open project" — least privilege.
// Every request path is canonicalised (resolving `..` and symlinks) and then
// verified, component-by-component, to live inside one of the allowed roots.
// Anything that escapes the sandbox is refused (the caller answers 403).
//
// The default roots (see build_default_roots()):
//   * the user's standard media folders — Music, Documents, Desktop, Downloads
//   * a dedicated "LivePlay" projects library under Documents (auto-created)
//   * any extra roots from the LIVEPLAY_FS_ROOTS environment variable
//     (OS-path-list separated: ';' on Windows, ':' elsewhere)
//   * the currently-open project's folder, injected dynamically via
//     set_project_root() so a project saved anywhere the operator chose stays
//     fully reachable by both the client and the server.
//
// Matching is case-insensitive on Windows (NTFS is) and case-sensitive
// elsewhere, and is component-wise so "/home/u/Music" never matches a sibling
// like "/home/u/Music-evil".
// ============================================================================
#pragma once

#include <filesystem>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace liveplay::util {

class FsSandbox {
public:
    struct Root {
        std::string           label;  // user-facing name, e.g. "Music"
        std::filesystem::path path;   // canonical, absolute
    };

    // Builds the platform default roots (media folders + projects library +
    // LIVEPLAY_FS_ROOTS extras) and ensures the projects library exists.
    FsSandbox();

    // Point the sandbox at the currently-open project's folder so its media
    // (and the .liveplay file itself) are always reachable, regardless of
    // where the operator saved it. Pass an empty path to clear it (no project
    // open). Thread-safe.
    void set_project_root(const std::filesystem::path& project_folder);

    // Canonicalise `utf8_path` and return the canonical path iff it resolves
    // inside an allowed root; std::nullopt when it escapes the sandbox (the
    // caller should answer HTTP 403). weakly_canonical is used so a target
    // that does not exist yet — e.g. a directory about to be created — still
    // validates against its (existing) ancestors. An empty input returns
    // nullopt: the "computer root" listing is handled by the caller, not here.
    // Thread-safe.
    std::optional<std::filesystem::path> authorize(const std::string& utf8_path) const;

    // Same containment test for an already-constructed path. Thread-safe.
    bool is_within_roots(const std::filesystem::path& candidate) const;

    // The roots to surface as the top level of the file browser (static roots
    // plus the open project), de-duplicated and filtered to those that exist
    // on disk. Thread-safe.
    std::vector<Root> roots() const;

private:
    mutable std::mutex    mutex_;
    std::vector<Root>     static_roots_;   // media folders + library + env extras
    std::filesystem::path project_root_;   // dynamic; empty when no project open

    static std::vector<Root> build_default_roots();
};

} // namespace liveplay::util
