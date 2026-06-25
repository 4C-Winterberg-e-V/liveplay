// ============================================================================
// fs_sandbox.cpp — see liveplay/util/fs_sandbox.hpp
// ============================================================================
#include "liveplay/util/fs_sandbox.hpp"
#include "liveplay/util/unicode_path.hpp"
#include "liveplay/logger.hpp"

#include <cstdlib>
#include <system_error>
#include <utility>

#if defined(_WIN32)
#  include <windows.h>
#  include <shlobj.h>          // SHGetKnownFolderPath
#  include <knownfolders.h>    // FOLDERID_*
#  include <objbase.h>         // CoTaskMemFree
#endif

namespace fs = std::filesystem;

namespace liveplay::util {

namespace {

// Lexically normalise + make absolute without requiring the path to exist.
// (weakly_canonical resolves symlinks for the portion that does exist, then
// appends the rest lexically — exactly what we want for not-yet-created
// targets like a mkdir destination.)
fs::path normalise(const fs::path& p) {
    std::error_code ec;
    fs::path c = fs::weakly_canonical(p, ec);
    if (ec || c.empty()) c = p.lexically_normal();
    return c;
}

// Compare two path components for equality. Case-insensitive on Windows
// (NTFS / drive letters are case-folding), exact elsewhere.
bool component_equal(const fs::path& a, const fs::path& b) {
#if defined(_WIN32)
    const std::wstring wa = a.wstring();
    const std::wstring wb = b.wstring();
    if (wa.size() != wb.size()) return false;
    // Ordinal, case-insensitive — avoids locale surprises.
    return CompareStringOrdinal(wa.c_str(), static_cast<int>(wa.size()),
                                wb.c_str(), static_cast<int>(wb.size()),
                                TRUE) == CSTR_EQUAL;
#else
    return a == b;
#endif
}

// True when `child` is `base` itself or lives somewhere beneath it. Both
// arguments must already be normalised + absolute. The comparison walks
// components so a string-prefix collision ("/a/Music" vs "/a/Music-evil")
// can never slip through.
bool path_within(const fs::path& base, const fs::path& child) {
    auto it_b = base.begin();
    const auto end_b = base.end();
    auto it_c = child.begin();
    const auto end_c = child.end();
    for (; it_b != end_b; ++it_b, ++it_c) {
        // Trailing empty component (from a trailing separator) — treat as end.
        if (it_b->empty()) break;
        if (it_c == end_c) return false;           // child is shorter than base
        if (!component_equal(*it_b, *it_c)) return false;
    }
    return true;                                   // base fully matched → within
}

#if defined(_WIN32)
std::optional<fs::path> known_folder(REFKNOWNFOLDERID id) {
    PWSTR raw = nullptr;
    if (SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, nullptr, &raw) != S_OK || !raw) {
        if (raw) CoTaskMemFree(raw);
        return std::nullopt;
    }
    fs::path p{raw};
    CoTaskMemFree(raw);
    if (p.empty()) return std::nullopt;
    return p;
}
#else
std::optional<fs::path> home_dir() {
    if (const char* h = std::getenv("HOME")) {
        if (*h) return fs::path{h};
    }
    return std::nullopt;
}
#endif

// Append `p` to `out` as a root labelled `label`, de-duplicating by canonical
// path so nested defaults (Documents + Documents/LivePlay) don't double up.
void add_root(std::vector<FsSandbox::Root>& out, std::string label, const fs::path& p) {
    if (p.empty()) return;
    const fs::path canon = normalise(p);
    if (canon.empty()) return;
    for (const auto& r : out) {
        if (component_equal(r.path, canon)) return;   // already present
    }
    out.push_back({std::move(label), canon});
}

// Split an OS path-list (LIVEPLAY_FS_ROOTS) on the platform separator.
std::vector<std::string> split_path_list(const std::string& s) {
#if defined(_WIN32)
    constexpr char sep = ';';
#else
    constexpr char sep = ':';
#endif
    std::vector<std::string> out;
    std::string cur;
    for (char c : s) {
        if (c == sep) { if (!cur.empty()) out.push_back(cur); cur.clear(); }
        else cur.push_back(c);
    }
    if (!cur.empty()) out.push_back(cur);
    return out;
}

} // namespace

std::vector<FsSandbox::Root> FsSandbox::build_default_roots() {
    std::vector<Root> roots;

    fs::path documents;   // remembered so the projects library can hang off it

#if defined(_WIN32)
    if (auto p = known_folder(FOLDERID_Music))     add_root(roots, "Music",     *p);
    if (auto p = known_folder(FOLDERID_Documents)) { documents = *p; add_root(roots, "Documents", *p); }
    if (auto p = known_folder(FOLDERID_Desktop))   add_root(roots, "Desktop",   *p);
    if (auto p = known_folder(FOLDERID_Downloads)) add_root(roots, "Downloads", *p);
    if (documents.empty()) {
        if (auto p = known_folder(FOLDERID_Profile)) documents = *p;
    }
#else
    if (auto home = home_dir()) {
        const fs::path h = *home;
        documents = h / "Documents";
        add_root(roots, "Music",     h / "Music");
        add_root(roots, "Documents", documents);
        add_root(roots, "Desktop",   h / "Desktop");
        add_root(roots, "Downloads", h / "Downloads");
        // Some Linux installs have no ~/Documents — fall back to the home dir
        // as the anchor for the projects library so "New project" still works.
        std::error_code ec;
        if (!fs::exists(documents, ec)) documents = h;
    }
#endif

    // Dedicated projects library — created so "New project" always has a home
    // inside the sandbox even on a fresh machine.
    if (!documents.empty()) {
        const fs::path library = documents / "LivePlay";
        std::error_code ec;
        fs::create_directories(library, ec);   // best-effort; safe (our own dir)
        add_root(roots, "LivePlay Projects", library);
    }

    // Operator-configured extra roots (NAS mounts, sample drives, …).
    if (const char* extra = std::getenv("LIVEPLAY_FS_ROOTS")) {
        for (const auto& entry : split_path_list(extra)) {
            const fs::path p = util::utf8_to_path(entry);
            std::error_code ec;
            if (fs::exists(p, ec)) add_root(roots, util::path_to_utf8(p.filename()), p);
        }
    }

    return roots;
}

FsSandbox::FsSandbox() : static_roots_(build_default_roots()) {
    std::string list;
    for (const auto& r : static_roots_) {
        if (!list.empty()) list += ", ";
        list += util::path_to_utf8(r.path);
    }
    Logger::info("Filesystem sandbox active — allowed roots: {}",
                 list.empty() ? std::string{"(none)"} : list);
}

void FsSandbox::set_project_root(const fs::path& project_folder) {
    fs::path canon = project_folder.empty() ? fs::path{} : normalise(project_folder);
    std::lock_guard lock{mutex_};
    project_root_ = std::move(canon);
}

bool FsSandbox::is_within_roots(const fs::path& candidate) const {
    if (candidate.empty()) return false;
    const fs::path canon = normalise(candidate);
    if (!canon.is_absolute()) return false;
    std::lock_guard lock{mutex_};
    if (!project_root_.empty() && path_within(project_root_, canon)) return true;
    for (const auto& r : static_roots_) {
        if (path_within(r.path, canon)) return true;
    }
    return false;
}

std::optional<fs::path> FsSandbox::authorize(const std::string& utf8_path) const {
    if (utf8_path.empty()) return std::nullopt;
    const fs::path canon = normalise(util::utf8_to_path(utf8_path));
    if (!canon.is_absolute()) return std::nullopt;
    std::lock_guard lock{mutex_};
    if (!project_root_.empty() && path_within(project_root_, canon)) return canon;
    for (const auto& r : static_roots_) {
        if (path_within(r.path, canon)) return canon;
    }
    return std::nullopt;
}

std::vector<FsSandbox::Root> FsSandbox::roots() const {
    std::lock_guard lock{mutex_};
    std::vector<Root> out;
    auto add_existing = [&out](const Root& r) {
        std::error_code ec;
        if (!fs::exists(r.path, ec) || !fs::is_directory(r.path, ec)) return;
        for (const auto& e : out) if (component_equal(e.path, r.path)) return;
        out.push_back(r);
    };
    // Open project first so it sorts to the top of the browser's "places".
    if (!project_root_.empty()) add_existing({"Project", project_root_});
    for (const auto& r : static_roots_) add_existing(r);
    return out;
}

} // namespace liveplay::util
