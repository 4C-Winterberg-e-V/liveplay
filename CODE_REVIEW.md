# LivePlay — Code Review & Audit (Phase 1)

> **Scope:** Read-only audit of the whole repository at branch `claude/repo-audit-modernization-0j5c42` (fork of `tdoukinitsas/liveplay`), commit `b47ea39`. No source code was changed; this report is the only artefact added.
> **Date:** 2026-06-26 · **Reviewer role:** Staff-level engineer.
> **Method:** The codebase was partitioned into 19 areas/dimensions; each was read in full by a dedicated reviewer, and **every finding was then independently re-verified against the cited source** by a second, adversarial pass (3 findings were rejected as false positives — see Appendix B). 167 findings survived verification (155 from the 19-area pass + a 12-finding follow-up review of the server bootstrap/crash/discovery code). After consolidating cross-area duplicates, this report presents **152 distinct findings**.

---

## Executive Summary

LivePlay is a genuinely capable, thoughtfully-commented live-audio cue system: a Nuxt 4 / Vue 3 / Electron client driving an out-of-process C++20 audio engine over a localhost/LAN HTTP+WebSocket protocol, plus a phone-facing web-share mode and a docs site. The core engineering instincts are good — the real-time audio path is largely lock-free, the client↔server sync layer is carefully reasoned, and the documentation is unusually honest about its own limitations.

**The dominant risk is security at the trust boundary.** The C++ control server binds to `0.0.0.0` by default with **no authentication, fully-open CORS, and filesystem read/write endpoints**, and the Electron app spawns it without restricting it to loopback. The result: anyone on the same network (Wi-Fi at a venue, a conference LAN) — and, when the web-share tunnel is enabled, anyone on the internet behind a brute-forceable 4-digit PIN — can drive playback, read and write files in the operator's Music/Documents/Desktop/Downloads folders, and trigger cues via a plain `GET` (so even a malicious web page the operator merely visits can fire cues). This single architectural decision spawns the bulk of the Critical/High findings.

**The second systemic risk is the absence of any safety net.** There are **zero automated tests** anywhere (≈10,500 lines of C++ + ≈4,700 lines of client composables), **no lint/type-check/static-analysis gate**, and **no committed lockfile**, so every release ships unverified and non-reproducibly. For a tool used live during shows, a regression in the sync engine, the `.lpa` parser, or the audio path would surface on stage. Two of the three Critical findings are not even exploits — they are a supply-chain hijack (the auto-updater still points every install at the *upstream* maintainer's GitHub) and a deploy config that simply does not build.

**Biggest risks (fix first):** the unauthenticated `0.0.0.0` control plane (C-01), the misdirected auto-updater (C-02), a stack-overflow crash reachable from a hostile/looping project (H-15), a use-after-free in the meter broadcast loop (H-14), and zip-slip/zip-bomb on `.lpa` import (H-10/H-11).

**Quick wins (high value, low effort):** bind the server to `127.0.0.1` and pass `--bind` from Electron (closes most of C-01 for the default desktop case); repoint the updater feed/publish metadata to the fork (C-02); fix the Dockerfile `COPY` (C-03); `git rm` the committed 73 KB crash dump (M-31); commit a `pnpm-lock.yaml` and switch CI to `--frozen-lockfile` (BUILD); add a lint/type-check CI job; rename `LICENCE.txt` → `LICENSE`; and correct the stale README facts.

**Overall assessment:** architecturally sound foundation, **not currently safe to run on an untrusted network**, and operationally fragile due to the complete lack of tests/CI gates. None of this requires a rewrite — the fixes are well-scoped and mostly additive.

### Findings at a glance

| Severity | Count | Nature |
|---|---:|---|
| 🔴 **Critical** | 3 | Network-exploitable control plane; supply-chain hijack of the updater; broken deploy build. |
| 🟠 **High** | 26 | Auth/CSRF/SSRF/path & zip handling; UDP reflection; a crash, a use-after-free, an unsafe crash-handler; god-modules; no tests; no CI gates. |
| 🟡 **Medium** | 53 | TOCTOU/zip-slip refinements, non-atomic save, listener leaks, dependency currency, container hardening, info-leaks, docs/hygiene. |
| ⚪ **Low** | 70 | Robustness/quality/accessibility nits, dead code, minor correctness. |
| **Total** | **152 distinct** | (167 verified findings; cross-area duplicates consolidated — see note below.) |

> **Consolidation note.** Several findings recur across areas because one root cause manifests in many files. They are merged here: the unauthenticated-`0.0.0.0` theme (6 raw findings → **C-01**), the upstream auto-updater (3 → **C-02**), the missing lockfile (2 → **BUILD/H**), the `project/load` sandbox bypass (3 → **H-09**), and the runtime binary downloads (3 → **H-04**). IDs are stable references for Phase 2.

---

## Stack & Architecture

**Languages / tooling**
- **Client:** TypeScript + Vue 3 (SFCs), Nuxt 4 (`ssr: false`, SPA), packaged with **Electron 42** via `electron-builder`; pnpm 9 workspace; SCSS. 47 components, ~12 composables.
- **Server:** **C++20**, built with **CMake + vcpkg** (manifest mode). Key deps: **Crow** (HTTP/WS), **nlohmann_json**, **miniaudio** (audio I/O + decode), **TagLib** (metadata), **miniz** (`.lpa` zip).
- **Docs site:** separate Nuxt 4 app, deployed to GitHub Pages.
- **Deploy:** Docker images (nginx / Caddy), Caddyfile, nginx.conf, Traefik dynamic config, docker-compose (two hosting modes).
- **Scripts:** Node build orchestration + a `version.js` bumper + locale tooling (one JS sync tool + seven redundant one-off Python/JS migration scripts).

**Architecture (data flow)**

```
                Electron main (privileged broker, main.js ~3,577 LOC)
                 │  spawns child process            │ express API :localPort (0.0.0.0)
                 │  ▼                                 │ web-share Express+http-proxy (0.0.0.0, +cloudflared)
   ┌─────────────┴───────────────┐                   │
   │  C++ liveplay-server          │◄── HTTP/WS ──────┴── Nuxt/Vue renderer (SPA)
   │  Crow control server :4480    │     (localhost / LAN)        ▲
   │   (0.0.0.0, NO AUTH, CORS *)  │                              │ phones via LAN/tunnel
   │  ├─ AudioEngine (RT callback + render thread, lock-free)     │
   │  ├─ ProjectState (doc + 50ms sequencer thread)               │
   │  ├─ FsSandbox (the ONLY access control)                      │
   │  └─ UDP discovery beacon                                     │
   └──────────────────────────────┘
```

The server is the source of truth for the project document and audio; the client keeps a reactive mirror, pushing local edits via a debounced **diff-watcher** (`useProject.ts`) and applying inbound `doc_patch` events with an `isHydrating` echo-suppression guard (`useLiveplayServer.ts`). The split (engine isolation, pimpl on Crow, an `FsSandbox`) is reasonable in principle.

**Structural weaknesses (detail in findings):**
1. **No authentication anywhere** on the control plane; `FsSandbox` is the sole control and it is bypassed by one route. → C-01, H-08/09.
2. **Four god-modules** concentrate the system's complexity and are structurally untestable: `main.js` (3,577), `project_state.cpp` (3,332), `control_server.cpp` (2,463), `useProject.ts` (1,860). → H-22, M-26/27/40.
3. **No shared protocol/schema contract** — the TS DTOs and the C++ JSON shapes are hand-maintained and can silently drift. → Gaps.
4. **A documented-but-unfixed circular auto-import** (`useCartItems ↔ useProject`) that forces Vue Devtools' timeline off. → M-24.
5. **Fork identity not updated** — publish target, homepage, author, and the auto-updater feed still point at upstream. → C-02, M-29/30.

---

## 🔴 Critical Findings

### C-01 · Unauthenticated control plane bound to `0.0.0.0` — full LAN/internet control of playback **and the filesystem**
- **Category:** Security · **Effort:** M (default-bind fix is S; full auth model is L)
- **Location:** `server/src/main.cpp:246,598` · `server/include/liveplay/net/control_server.hpp:53` · `server/src/net/control_server.cpp:359` (bind), `:888-895` (CORS `*`), `:1289-1374` (fs/list, upload), `:1705-1910` (export/download/import) · `client/electron/main.js:540-543` (spawn omits `--bind`), `:1472-1657` (Electron's *own* express API, also `0.0.0.0`, also no auth) · `client/electron/web-share.js:212` (LAN bind)
- **Description:** `ControlServerConfig::bind_address` and `CliOptions::bind_addr` both default to `"0.0.0.0"`, and the Electron launcher spawns the server with only `--port`/`--pidfile`, **never `--bind`**, so even ordinary "Local" mode listens on every interface. Crow runs with no middleware, token, or password gate of any kind (verified: none exists), and emits `Access-Control-Allow-Origin: *`. The exposed surface includes playback control, full project disclosure (`GET /api/project/info`), directory listing, `mkdir`, file upload/copy, and `.lpa` export/import/download — scoped only by `FsSandbox`, whose default roots are the user's Music/Documents/Desktop/Downloads + a LivePlay library folder. Electron *additionally* stands up its own express control API on `0.0.0.0` with no auth (`main.js:1657`).
- **Impact:** Any host on the same network — a venue's shared Wi-Fi, a hotel/conference LAN — can take over playback mid-show and read/write files in the operator's home folders **without any credential**. With web-share's tunnel enabled the same surface is reachable from the internet (behind only the weaknesses in H-06/H-07). This is the repository's central risk and the root of most other High findings.
- **Recommendation:** (1) **Immediately:** default the bind to `127.0.0.1` and have Electron pass `--bind 127.0.0.1` for Local mode — this closes the LAN exposure for the common desktop case at near-zero cost. (2) Introduce a real auth layer for any non-loopback exposure: a per-session bearer token (the client already holds one channel to inject it) or a pairing/PIN handshake, checked in a Crow `before_handle` middleware on **all** routes incl. `/ws`; restrict CORS to the real client origin. (3) Treat web-share's LAN path with the same auth as its tunnel path (see H-05/06/07). (4) Apply the same bind/auth fix to Electron's express API or remove it.

### C-02 · Auto-updater and manual-update fallback point at the **upstream** repo — supply-chain hijack of every fork install
- **Category:** Security / Supply chain · **Effort:** S
- **Location:** `client/electron/main.js:1682-1687` (`autoUpdater.setFeedURL` hard-codes `owner:'tdoukinitsas', repo:'liveplay'`), `:1753` & `:1778` (manual fallback fetches `https://tdoukinitsas.github.io/liveplay/...`), `:2687` (`quitAndInstall`) · `client/package.json:94-98` (`build.publish.owner = tdoukinitsas`), `:5` (homepage), `:110` (signtool publisherName)
- **Description:** The git remote is `4C-Winterberg-e-V/liveplay`, but the runtime update feed is hard-coded to the upstream maintainer's GitHub releases, and the manual-update path downloads from the upstream's GitHub Pages. `electron-builder`'s publish config agrees. So a fork build will pull, and offer to install, binaries it does not control.
- **Impact:** Whoever controls `tdoukinitsas/liveplay` releases (or that GitHub Pages site) can push an executable to every fork user — a classic supply-chain takeover. Even absent malice, fork users silently receive *upstream* builds, diverging from the code they think they run. Combined with the fact that **all releases are unsigned/un-notarized** (M-35), there is no second line of defence.
- **Recommendation:** Repoint `setFeedURL`, the manual-update URLs, `build.publish`, `repository`, `homepage`, and `author` to the fork before any release that ships auto-update; **or** disable auto-update until the feed is corrected. Add Authenticode/notarization (M-35) and publish SHA-256 checksums as defence-in-depth.

### C-03 · Deploy Dockerfiles `COPY` a `package-lock.json` that does not exist — image build fails outright
- **Category:** CI/CD / Correctness · **Effort:** S
- **Location:** `deploy/Dockerfile:17` · `deploy/Dockerfile.caddy:14`
- **Description:** Both images run `COPY client/package.json client/package-lock.json ./`, but no `package-lock.json` is tracked or present anywhere in the repo (it is even gitignored; the project uses pnpm). When `COPY` names multiple explicit sources and one is missing, BuildKit fails the build.
- **Impact:** Every documented self-hosting path (`deploy/README.md` Mode A/B) is unbuildable as written — the flagship "host the web client" feature cannot be deployed from a clean checkout. No CI builds these images (Gaps), so it went unnoticed.
- **Recommendation:** Switch the deploy build to pnpm with a committed `pnpm-lock.yaml` (`COPY pnpm-lock.yaml`, `pnpm install --frozen-lockfile`), or drop the lockfile from the `COPY` until one exists. Add a `hadolint` + image-build smoke job to CI.

---

## 🟠 High Findings

### Electron client & web-share

**H-01 · Both BrowserWindows run with `webSecurity:false` and there is no Content-Security-Policy** — Security · S
`client/electron/main.js:1824` (main window), `:1902` (cart-player window); no CSP/`onHeadersReceived`/custom protocol anywhere in `client/electron`.
Same-Origin Policy is disabled on both windows and there is no CSP, so any script that reaches the renderer (e.g. via an injected string, a dependency, or a future `v-html`) can load and exfiltrate cross-origin freely. `contextIsolation:true`/`nodeIntegration:false` are correctly set, which limits direct RCE, but the renderer has broad bridge access. *Fix:* serve local files via a custom `protocol.handle` with SOP on, set a strict CSP via `onHeadersReceived`, and remove `webSecurity:false` (find and fix the underlying file:// loading reason instead).

**H-02 · No navigation / window-open guards; `open-external` forwards arbitrary renderer URLs to the OS shell with no scheme allow-list** — Security · S
`client/electron/main.js:2629-2636` (`open-external` → `shell.openExternal(url)` unfiltered); `createWindow` (1813-1882) and `createCartPlayerWindow` (1885-1930) install no `will-navigate`/`will-redirect`/`setWindowOpenHandler`.
A compromised or tricked renderer can navigate the window to arbitrary content or hand the OS shell a `file:`/custom-scheme URL. *Fix:* add `setWindowOpenHandler` returning `{action:'deny'}` (open vetted URLs externally), a `will-navigate` guard pinning the app origin, and an `http(s)`-only allow-list in `open-external`.

**H-03 · Path-handling IPC accepts arbitrary renderer-supplied paths with no validation or sandbox confinement** — Security · M
`client/electron/main.js:2525` (read-file), `:2534` (read-audio-file), `:2545`/`:2584` (write/-binary), `:2594` (copy), `:2608` (ensure-directory), `:2619` (open-folder); import flows `:2813`,`:2895`.
The main process reads/writes/copies/mkdirs any path the renderer names, with no allow-listing or confinement to a project root — a renderer compromise becomes arbitrary host file access. *Fix:* add a shared `validateInsideRoot()` for every path IPC, confining to the open project + explicit user-picked paths. (The zip-slip sub-claim was downgraded — `extract-zip@2.0.1` mitigates it.)

**H-04 · `yt-dlp` and `deno` are downloaded from GitHub at runtime and executed with no checksum/signature verification** — Security · M *(merges 3 findings)*
`client/electron/main.js:1241-1321` (yt-dlp `downloadFromGithub`), `:1336-1427` (deno download `:1393`, `chmod 0755 :1399`), executed at `:3204/:3236/:3246`; deps `client/package.json:58-59`.
On launch the app fetches two executables over the network and runs them with no integrity check; a compromised release asset, MITM, or account takeover of those upstreams yields code execution on the operator's machine. *Fix:* pin exact versions, verify a published SHA-256 (and signature where available) before `chmod`/exec, and fetch over pinned TLS; make the YouTube feature opt-in (see M-33).

**H-05 · No Host/Origin validation on the web-share proxy — DNS-rebinding lets a remote page drive the local server** — Security · M
`client/electron/web-share.js:158-208,464-485`; `client/nuxt.config.ts:87-91` (`allowedHosts:true`).
Neither the Express chain nor the WS upgrade handler checks `Host`/`Origin`; combined with the `0.0.0.0` bind, a victim who visits an attacker page can have their browser rebind DNS to `127.0.0.1`/LAN IP and reach the unauthenticated API. *Fix:* enforce a `Host`/`Origin` allow-list on HTTP and the WS upgrade; lock `allowedHosts` in production.

**H-06 · 4-digit PIN with no rate limiting or lockout on an internet-facing tunnel** — Security · M
`client/electron/web-share.js:359,500-511,584-588`; `client/electron/main.js:842`.
When the cloudflared tunnel is up the default credential is a 4-digit numeric PIN (10⁴ space) and `_authOk` has no attempt counter, delay, or lockout (the code comment concedes this). A public endpoint is brute-forceable in seconds. *Fix:* longer random default secret, exponential backoff + lockout, and per-IP throttling; consider device pairing.

**H-07 · Web-share auth gate can be fully disabled, publishing the filesystem + control surface to the public internet** — Security · S
`client/electron/web-share.js:73-75,379-387`; `client/electron/main.js:829-835`.
`setAuthEnabled(false)` clears auth while the tunnel keeps serving, exposing the unauthenticated filesystem/control API publicly behind only a warning string. *Fix:* gate disabling behind an explicit typed confirmation, keep "auth on" sticky, and refuse to disable auth while a public tunnel is active.

### C++ control server, sandbox & project state

**H-08 · `GET` accepted on play/trigger routes → trivial CSRF / drive-by cue triggering** — Security · S
`server/src/net/control_server.cpp:2149-2163` (`/items/<uuid>/play`), `:2174-2217` (`/items/by-index/...`); both `.methods(POST, GET)`.
State-mutating playback is reachable by `GET`, so with open CORS and no auth any web page the operator visits (an `<img src>`, link, or prefetch) can fire or stop cues cross-origin. *Fix:* remove `GET` from mutating routes; require POST + auth + a restricted origin.

**H-09 · `/api/project/load` deliberately bypasses the filesystem sandbox and auto-promotes the parent folder to a permanent sandbox root** — Security · M *(merges 3 findings)*
`server/src/net/control_server.cpp:1606-1626`; `server/src/util/fs_sandbox.cpp:181-209`.
The `path` branch of project-load skips `authorize()` (comment: "allowed from anywhere"), loads any absolute path, then calls `set_project_root(p.parent_path())` — turning any attacker-chosen path's directory into a writable sandbox root. On the unauthenticated server this is a remote arbitrary-file-read primitive that also *widens* the sandbox for every subsequent request. *Fix:* authorize the load path like every other route, or restrict by-path load to the loopback/local client only; never auto-promote an unvalidated parent to a root.

**H-10 · `.lpa` zip extraction relies on a substring `..` check, not path-component containment** — Security · M
`server/src/net/control_server.cpp:205-246` (`zip_extract_to`), `:1860-1888` (import authorizes only the root).
Entry safety is `name.front() != '/'/'\\'` + "contains `..`?" then `dest = out_dir / name` with no canonicalize-and-recheck. This both over-rejects legitimate names and misses platform-specific escapes; on the unauthenticated server it is a remote write-outside-sandbox via the primary import workflow. *Fix:* after building `dest`, canonicalize and verify component-wise containment in `out_dir` (reuse `FsSandbox::path_within`); reject symlink entries, drive-relative/UNC names.

**H-11 · Zip-bomb + unbounded request bodies — memory-exhaustion DoS** — Security / Performance · M *(merges the import zip-bomb and the buffered-body DoS)*
`server/src/net/control_server.cpp:205-246` (no `m_uncomp_size`/entry-count cap), `:1338-1374` (upload checks size *after* full buffering), `:1805-1848` (import writes multipart unbounded); Crow started with no `app.max_payload()` (`:359`).
`.lpa` extraction has no per-entry or total uncompressed cap, and Crow buffers the entire body in RAM before any size check runs, so an unauthenticated client can exhaust memory/disk and knock the engine over mid-show. *Fix:* set `app.max_payload(...)`; enforce per-entry, total-uncompressed, and entry-count caps in `zip_extract_to`; stream/limit the import multipart write.

**H-14 · Use-after-free: meter/cue-state broadcast loop dereferences `engine_.find_cue()` raw pointers outside the engine lock** — Correctness (concurrency) · M
`server/src/net/control_server.cpp:408-430,474-486`; `server/src/audio/engine.cpp:450-464` (`find_cue` returns `PlaybackItem*` after releasing `mutex_`; `unload_cue` erases the `shared_ptr`).
`find_cue` hands back a raw pointer into an `unordered_map<…, shared_ptr<PlaybackItem>>` *after* dropping the lock; the ~10–60 Hz broadcast thread dereferences it while a control-thread `unload_cue` can erase and free the item. This is a textbook data race / use-after-free that will eventually crash during live use. *Fix:* have `find_cue` return a `shared_ptr` (keep ownership alive across the deref), or copy the needed values under the lock; document the lifetime contract.

**H-15 · Unbounded recursion in `play_item`/`trigger_item` (startBehavior/group chains) → stack-overflow crash mid-show** — Correctness / Robustness · M
`server/src/core/project_state.cpp:2226-2229` (`play` startBehavior recurses into `play_item`), `:2276-2338` (`trigger_item` recurses into group children, `:2330/:2335`); no cycle guard.
A project where cue A's start-behavior plays cue B whose start-behavior plays A (or a self-referential group) recurses synchronously until the stack overflows and the server crashes — reachable from an untrusted/imported or merely mis-edited project. *Fix:* add cycle detection (visited-set) and a recursion/fan-out depth cap; reject or repair cyclic graphs in `detect_and_repair`.

### Real-time audio & media parsing

**H-16 · LTC generator is force-reset every render block, destroying biphase/timecode continuity** — Correctness · M
`server/src/audio/playback_item.cpp:448-451`; `server/src/audio/ltc_generator.cpp:67-88,184-200`.
`render_block` calls `ltc_->configure(...)` every block, and `configure()` unconditionally `reset()`s (frame counter → -1, polarity → +1), so generated LTC never advances coherently — any downstream device chasing this timecode will not lock. *Fix:* only (re)configure on actual parameter change; keep generator state across blocks and resync explicitly on seek/start.

**H-20 · Unbounded channel count drives unbounded allocation in `compute_waveform`** — Security (DoS) · S
`server/src/meta/waveform.cpp:37-68`.
`channels` from the decoder is only zero-checked, then `out.channels.assign(channels, …)` allocates per-channel bucket vectors with no upper bound — an attacker-influenced file with an absurd channel layout can blow up memory (and `compute_waveform` is `noexcept`, so `bad_alloc` → `std::terminate`, see L-/meta). *Fix:* clamp channel count to a sane max, validate decoder-reported values before allocating, and remove `noexcept` or guard allocations.

**H-21 · `compute_waveform` runs synchronously on the HTTP request thread for `/api/waveform` and `/api/waveform_path`** — Performance · M
`server/src/net/control_server.cpp:1490,1529`; `server/src/meta/waveform.cpp:74-106`.
These routes decode the whole file inline on a Crow worker (unlike the queued, cached `waveform_worker` path used elsewhere), so a large/slow file ties up a request thread and can starve the control plane during a show. *Fix:* route both through the existing async, disk-cached worker; never decode inline on the request thread.

### Server bootstrap, crash handler & network discovery

**H-25 · UDP discovery beacon is an unauthenticated reflection/amplification vector on the LAN** — Security · M
`server/src/net/discovery.cpp:384-408`.
The beacon binds `INADDR_ANY:4481` and replies to any `{"type":"liveplay-solicit"}` packet with a full beacon payload sent **unicast to the (spoofable, unvalidated) source address** from `recvfrom`. The reply (hostname + project name + version, 150–300+ B) is several times larger than the ~28 B solicit, with no rate limit and no on-link source check — so one attacker can turn every LivePlay box on the segment into a reflector aimed at a victim. (The packet *parsing* itself was confirmed bounds-safe — not an overflow.) *Fix:* rate-limit replies per source + globally, drop solicits whose source is off-link/non-local, cap the reply to the request size or require an echoed nonce; consider disabling the solicit-reply path by default.

**H-26 · POSIX crash handler calls async-signal-unsafe functions from the signal handler** — Correctness / Robustness · L
`server/src/crash_handler.cpp:390-410,221-318` (registered at `:436-446`).
The `SIGSEGV/SIGABRT/SIGFPE/SIGILL/SIGBUS` handler does heap allocation (`std::string`, `backtrace_symbols`→`malloc`), iostreams/`std::ofstream`, `std::filesystem::create_directories`, and `fork()` — none async-signal-safe. For the crash classes that matter most (heap corruption, OOM, stack overflow — likely when processing untrusted media), the handler deadlocks on the malloc lock or re-faults, so the very crash that needs a report produces none and may hang the process mid-show (the exact "window vanished, no logs" symptom it exists to prevent; no `sigaltstack` either). *Fix:* in the signal path use only async-signal-safe calls (`backtrace_symbols_fd`, pre-opened fd + `write(2)`, pre-created log dir); do rich logging/restart only from `std::terminate` or a separate watchdog; install a `sigaltstack`. (See M-49…M-53 for the related restart/permission/log-injection issues.)

### Client correctness & leaks

**H-12 · SSRF / arbitrary fetch from the privileged renderer via a project-defined `http-request` custom action** — Security · M
`client/app/composables/useAudioEngine.ts:311-316,445-466`; server fan-out `server/src/net/control_server.cpp:348-353`.
On a `custom_action_http` `doc_patch` the client does `fetch(request.url, …)` with method/body/URL taken straight from the **project document** (which can arrive over the LAN/import) and zero validation — the server broadcasts it unvalidated. A crafted project turns any connected client into an SSRF/exfil proxy. *Fix:* validate/allow-list the URL scheme+host, require explicit user opt-in per action, and never execute project-sourced requests silently.

**H-13 · LAN-reachable mass-assignment of arbitrary cue/cart fields via the HTTP API** — Security · M
`client/app/components/MainWorkspace.vue:236-263`; `client/electron/main.js:1500-1518,1657`.
The API update handlers copy every field in the request body onto the live item except an 8-entry deny-list, so any field outside that list (on the unauthenticated `0.0.0.0` express API) can be overwritten on a live cue. *Fix:* switch to a per-field **allow-list** with type/range validation; pair with auth (C-01).

**H-17 · `syncItemsDiff` swallows every per-item server error, silently desyncing client and server** — Correctness · M
`client/app/composables/useProject.ts:1656-1740`.
The diff baselines are rotated *before* the awaited add/remove/update/reorder calls, and each call is wrapped in `try { await … } catch {}` (empty). A transient failure (5xx, reconnect window) leaves the baseline advanced but the server unchanged — the divergence is invisible until playback misbehaves. *Fix:* roll the baseline forward only on success; on failure, surface an error and re-queue/re-fetch.

**H-18 · `isHydrating` is a shared boolean latch reset via `queueMicrotask`, racing concurrent `doc_patch`/stream flows** — Correctness · M
`client/app/composables/useProject.ts:1303-1541,708-803`.
A single global re-entrancy guard is toggled with mismatched async timings (`queueMicrotask` in `applyDocPatch` vs `await nextTick` elsewhere); overlapping hydrate/patch flows can clear it early, letting an echo be treated as a user edit (or vice-versa). *Fix:* replace the boolean with a counter/owner token; use one consistent flush mechanism.

**H-19 · `useAudioEngine` leaks WS subscribers and a watcher on every component instance** — Performance / Correctness · M
`client/app/composables/useAudioEngine.ts:261-383`.
Every call registers `onCueState/onPlaybackSnapshot/onDocPatch/onMeters` + a `watch` and captures none of the unsubscribe handles; there is no `onUnmounted/onScopeDispose`. It is called per-row (`PlaylistItem`) and per-slot (`CartSlot`), so a large project leaks hundreds of live subscribers, degrading over a long session. *Fix:* capture every unsubscribe and dispose in `onScopeDispose`; or hoist to a single app-level subscription.

### Architecture, tests & CI

**H-22 · `useProject.ts` is a 1,860-line god-composable owning ~12 unrelated responsibilities** — Architecture · L
`client/app/composables/useProject.ts:1-1860`.
Selection/clipboard, file I/O, header hydration, paged streaming, autosave gating, three dialog state-machines, and the entire local→server diff engine live in one module with hand-rolled singleton globals — the highest-churn, highest-risk file in the client, and untestable as-is. *Fix:* extract `useProjectSync`, `useProjectIO`, `useProjectDialogs`, and a pure selection module behind a thin `useProject` facade (see M-26).

**H-23 · No quality gates anywhere in CI — no lint, type-check, or tests on client or server** — CI/CD · M
`.github/workflows/build-release.yml`; `.github/workflows/build-server.yml:148-160`; `client/package.json:8-18`.
Three workflows exist; none runs a test, linter, or type-checker. The release pipeline goes from build straight to a **public** GitHub Release with no gate; the server's only check is a `--help` smoke test. *Fix:* add a PR gate running `vue-tsc`/`nuxt typecheck` + ESLint (client) and `-Werror` + clang-tidy + a boot-and-curl smoke test (server) before any release.

**H-24 · Zero automated tests across the entire codebase** — Tests · L
`package.json`, `client/package.json` (no `test` script), `server/CMakeLists.txt` (no CTest/GTest); only a `--help` smoke test in CI.
≈10,500 lines of C++ engine/server and ≈4,700 lines of client composables ship with no unit, integration, or E2E test, no coverage, and no sanitizer build — for a tool run live, every change ships with no regression net. The god-modules (M-40) make this worse by being structurally untestable. *Fix:* stand up Vitest (client) + CTest/doctest (server) + a happy-path integration test (spawn→load→play→stop); start by extracting pure logic (sandbox checks, diff math, fade/LTC math, project (de)serialization) and testing it. See "Was fehlt?" for the full gap list.

> **Builds are non-reproducible (High, cross-listed as BUILD/M-38/H):** no `pnpm-lock.yaml` is committed anywhere (and `package-lock.json` is gitignored), while CI installs with `--no-frozen-lockfile` and caret ranges — so signed release binaries are built from an unpinned, drifting dependency graph and CI cache keys are inert. *Fix:* generate and commit `pnpm-lock.yaml`, switch CI to `--frozen-lockfile`. (See M-38 and Dependencies.)

---

## 🟡 Medium Findings

> Each entry: **ID · [Kategorie] Titel**, location, effort, one-line impact, and fix. Sorted by category within severity.

**M-01 · [Security] Web-share modal displays BasicAuth credentials in plaintext and the auth toggle can expose a public tunnel**  
`client/app/components/WebShareModal.vue:82-114,141-143` · Aufwand **M**  
WebShareModal.vue:110-113 renders `{{ status.auth.user }} / {{ status.auth.pass }}` in clear text when the tunnel is up. The auth toggle (82-86) is a checkbox bound to status.authEnabled that calls toggleAuth;  
*Fix:* Gate disabling auth behind an explicit confirm, enforce a minimum PIN length when auth is on, mask the displayed password behind a reveal toggle, and keep 'auth on' as a sticky default.

**M-02 · [Security] Clipboard paste imports unvalidated item objects directly into the project tree**  
`client/app/composables/useProject.ts:457-499` · Aufwand **M**  
parseItemsFromText (457-471) accepts arbitrary clipboard JSON and filters only on type==='audio'|'group' and typeof displayName==='string' (466-470). pasteItemsFromClipboard (476-499) then deep-clones each with fresh uuids (cloneItemWithNewIds) and pushes straight into currentProject.items, then saveProject() syncs to…  
*Fix:* Validate pasted items against the AudioItem/GroupItem schema (reject unknown/unsafe action types, sanitise paths, cap count) before insertion, reusing the server's load-time validation.

**M-03 · [Security] TOCTOU: authorize() validates a canonical path that callers re-open later; a writable root lets an attacker swap in a symlink between check and use**  
`server/src/util/fs_sandbox.cpp:199-209 (authorize returns a string path); control_server.cpp:1391-1410 (copy_to_media), 1885 (import extract), 1331 (mkdir)` · Aufwand **L**  
Confirmed mechanism. authorize() (fs_sandbox.cpp:199-209) uses normalise()→weakly_canonical (29-34), resolving symlinks only for the existing prefix, and returns a path STRING, not an O_NOFOLLOW/openat handle.  
*Fix:* Treat authorize() output as advisory and re-verify atomically at use: open final components with O_NOFOLLOW (or openat relative to a pre-opened validated root fd) and refuse to follow symlinks for writes. Reject any path component that is…

**M-04 · [Security] No file-size or decode-time limit before handing attacker-supplied files to TagLib/miniaudio**  
`server/src/meta/metadata.cpp:47-96; server/src/meta/waveform.cpp:16-49` · Aufwand **M**  
read_metadata wraps the TagLib path in try/catch (metadata.cpp:50-95, good) but calls duration_via_miniaudio on every fallback branch (lines 63, 85, 92), which opens/probes the file with miniaudio. compute_waveform likewise opens arbitrary paths (waveform.cpp:26/31).  
*Fix:* Enforce a maximum file size and a maximum plausible declared duration/frame count before decoding; decode with a wall-clock timeout on a worker thread. Track/pin TagLib and miniaudio versions and keep them updated.

**M-05 · [Security] Media path resolution allows references outside the project folder (no sandbox check on mediaPath)**  
`server/src/core/project_state.cpp:80-112 (resolve_media_path), 485-489 (start_async_mirror), 851-854 (mirror_items_to_engine_locked)` · Aufwand **M**  
resolve_media_path (80-112) concatenates folder + '/' + mediaPath (86-91) and returns it if the file exists (99-101), and otherwise honours an absolute mediaServerPath (94-96,103-105), with no check that the result stays inside the project folder. The async mirror (485-489) and mirror_items_to_engine_locked (851-854)…  
*Fix:* After resolving, verify the canonical path is within the project folder (reuse FsSandbox::is_within_roots / a path_within check); reject and log out-of-folder references unless the operator explicitly allowed external roots.

**M-06 · [Security] Zip-slip sanitisation is substring-based and misses Windows drive-relative entries**  
`server/src/net/control_server.cpp:220-238 (zip_extract_to entry-name checks)` · Aufwand **S**  
zip_extract_to rejects entries whose name.front() is '/' or '\\' (223-226) or whose name contains the substring ".." anywhere (227-230), then builds dest = out_dir / utf8_to_path(name) (231) with no verification that dest stays within out_dir. This (a) over-rejects legitimate names containing '..' such as…  
*Fix:* After constructing dest, canonicalise and verify it is within out_dir (reuse FsSandbox::is_within_roots logic); add explicit drive-letter/UNC rejection and treat the string heuristic as a fast pre-filter only.

**M-07 · [Security] Lifecycle install scripts enabled with hoisted node-linker — broad postinstall execution surface**  
`.npmrc:4 (node-linker=hoisted), .npmrc:13 (enable-pre-post-scripts=true); pnpm-workspace.yaml:11-16 (onlyBuiltDependencies)` · Aufwand **M**  
.npmrc line 4 sets `node-linker=hoisted`, line 13 sets `enable-pre-post-scripts=true`. pnpm-workspace.yaml lines 11-16 list onlyBuiltDependencies: electron, esbuild, cloudflared, @ffmpeg-installer/ffmpeg, @ffprobe-installer/ffprobe — all of which fetch native binaries via postinstall.  
*Fix:* Keep onlyBuiltDependencies minimal (it already is) and pair it with a committed lockfile so the built packages are integrity-pinned. Pin the binary-downloader packages to exact versions and verify their downloaded binary checksums where…

**M-08 · [Security] /api/project/info on the unauthenticated 0.0.0.0 control API discloses the full project to any LAN client**  
`client/electron/main.js:1645-1653 (GET /api/project/info), served by apiApp.listen(currentPort) at 1657` · Aufwand **S**  
While verifying the API-server finding, I noted GET /api/project/info returns res.json({ success:true, project: currentProjectData }) — the entire synced project structure (item names, file paths, cart layout, metadata) — with no auth, on the same 0.0.0.0-bound server. This is an information-disclosure facet distinct…  
*Fix:* Same fix as the bind/auth finding: bind 127.0.0.1 and/or require a token; treat project data as sensitive.

**M-09 · [Security] BasicAuth credentials embedded in the QR/tunnel URL and surfaced to the renderer**  
`client/electron/web-share.js:457-461,106,122,351` · Aufwand **M**  
tunnelLinkWithAuth() builds https://liveplay:<pin>@host (web-share.js:460) and status() renders that credential-bearing URL into the tunnel QR (web-share.js:106 via safeQr(this.tunnelLinkWithAuth())). status().auth also returns { user, pass } as plaintext to the renderer (web-share.js:122).  
*Fix:* Deliver the credential out-of-band (show the PIN separately / have the page prompt) rather than embedding it in the URL/QR. If kept for UX, rotate the PIN per session and document the exposure.

**M-10 · [Correctness] add_dual_dialog_locales.py resolves the locales directory relative to the script dir, not the repo root — it silently processes zero files**  
`scripts/add_dual_dialog_locales.py:541-542` · Aufwand **S**  
Confirmed at line 541: main() computes locale_dir = os.path.join(os.path.dirname(__file__), 'client', 'locales') which resolves to scripts/client/locales — verified non-existent (ls -> No such file or directory). The isdir() guard at line 542 then prints 'ERROR: ...  
*Fix:* If kept, resolve the repo root explicitly: locale_dir = os.path.join(os.path.dirname(__file__), '..', 'client', 'locales'). Apply the same to all five so they run from any cwd, matching the Node convention path.resolve(__dirname, '..')…

**M-11 · [Correctness] PropertiesPanel "Replace media" button is a non-functional stub**  
`client/app/components/PropertiesPanel.vue:81-84,836-844` · Aufwand **M**  
The swap-media icon button (PropertiesPanel.vue:81-84, `<button class="icon-btn" @click="handleReplaceMedia">`) invokes handleReplaceMedia (836-844), which opens the native file dialog via window.electronAPI.selectAudioFiles() and then only runs `console.log('Replace media with:', files[0]);` with the comment…  
*Fix:* Implement replacement (register new media, update mediaFileName/mediaPath, regenerate waveform/duration, save) or disable/hide the button until implemented.

**M-12 · [Correctness] Streamed item-page push under shared isHydrating can be raced by an unrelated edit**  
`client/app/composables/useProject.ts:708-803` · Aufwand **M**  
streamItemPages flips isHydrating true/false around each 100-item page with await nextTick() between pages (726-747) and yields to requestAnimationFrame between pages (754-760). Between pages — and during the RAF yield — isHydrating is false, so a user edit (or an inbound doc_patch resetting the flag via…  
*Fix:* Hold isHydrating (or the proposed counter) true for the entire stream, or block user mutation behind isLoading until the stream + baseline refresh complete.

**M-13 · [Correctness] isReservedCombo / RESERVED_COMBOS is not enforced in updateBinding — reserved combos are merely advisory**  
`client/app/composables/useCartHotkeys.ts:4-27,228-242,244-268,206-226` · Aufwand **M**  
RESERVED_COMBOS (4-18) covers Ctrl+S/Q/W/Z/N/O/A/C/V/X/Y/R and F1. isReservedCombo is exported (26-27) and used ONLY in UI components CartHotkeyConfig.vue:86 and ControlConfigModal.vue:335 — verified via grep.  
*Fix:* Enforce isReservedCombo() inside updateBinding/updatePlaybackBinding (reject reserved combos) and bail out of handleKeydown before preventDefault when the matched binding is reserved. Validate bindings on project load/import.

**M-14 · [Correctness] Production gated on primary device only; shared rendered block dropped for full secondary-device rings causes drift/clicks**  
`server/src/audio/engine.cpp:817-828, 1007-1024` · Aufwand **L**  
render_loop gates production solely on the PRIMARY device's writable space (devices_.front(), lines 817-826) to avoid secondary clock drift starving the primary. The dispatch loop writes the SAME rendered block into every device's ring;  
*Fix:* Per-device clock reconciliation: independent rate tracking/resampler per device, or drive each device from its own consumption counter. At minimum warn the operator when more than one device is assigned. A single shared block cannot…

**M-15 · [Correctness] macOS case-insensitive/Unicode-normalising filesystem not accounted for in containment check**  
`server/src/util/fs_sandbox.cpp:38-50 (component_equal), 56-68 (path_within)` · Aufwand **M**  
component_equal (38-50) does case-insensitive ordinal comparison only under _WIN32; the #else branch is exact byte equality `a == b` (48), which applies on macOS.  
*Fix:* On Apple platforms, fold case and normalise both sides to a single Unicode form (NFC) before comparing components, or compare via inode identity for the existing prefix. At minimum update the header comment to document the macOS behaviour…

**M-16 · [Correctness] replace_full_document() bypasses detect_and_repair validation applied on load**  
`server/src/core/project_state.cpp:1484-1510 (replace_full_document), 2739-2794 (load_from_json runs detect_and_repair at 2748), 1828-1842 (reorder collapses duplicate uuids)` · Aufwand **S**  
replace_full_document() (1484-1510, behind PUT /api/project/document) stores doc verbatim after only an is_object() check (1485), adding default settings/theme but never calling detect_and_repair() or validating UUIDs. load_from_json() runs detect_and_repair() before storing (2748).  
*Fix:* Run detect_and_repair() inside replace_full_document() before storing and surface pending_repair_info_, mirroring load_from_json().

**M-17 · [Correctness] save() is not atomic and does not check stream state, so a crash/full disk corrupts the project file and may report false success**  
`server/src/core/project_state.cpp:1335-1363 (save)` · Aufwand **S**  
save() opens the destination directly with std::ofstream f{path} (1341), which truncates the existing file, then streams doc.dump(2) into it (1357) and returns true (1358) with no check of stream state after the write. There is no write-to-temp-then-rename and no fsync.  
*Fix:* Write to a sibling temp file, flush/close and check stream state (ideally fsync), then std::filesystem::rename over the target (atomic on same volume); return false if the stream went bad.

**M-18 · [Correctness] remoteUrl and recent-server URLs from the renderer are persisted with no scheme/host validation**  
`client/electron/main.js:154-166 (readLiveplayConfig), 681-697 (liveplay-server:set-config), 310-325 (addRecentServer)` · Aufwand **S**  
set-config (681-697) spreads arbitrary `incoming` over the existing config and only clamps localPort (1-65535) and mode (local/remote); remoteUrl passes through untouched.  
*Fix:* Validate remoteUrl/recent url are http(s) with a sane host/port before persisting in set-config and addRecentServer; reject other schemes.

**M-19 · [Robustness] Tunnel readiness for named tunnels keyed on log-string matching — fragile across cloudflared versions**  
`client/electron/web-share.js:48,298-299,330,335` · Aufwand **M**  
Quick tunnel readiness parses the trycloudflare URL via TUNNEL_URL_RE (web-share.js:48, matched at 298-299). Named tunnel readiness matches READY_RE=/Registered tunnel connection|Connection .+ registered/i against cloudflared stdout/stderr (web-share.js:330,335).  
*Fix:* Pin/bundle a known cloudflared version, add a startup timeout that surfaces an error instead of hanging, and prefer structured/JSON log output or poll the metrics/readiness endpoint rather than free-text matching.

**M-20 · [Performance] Per-block heap allocation in the render path (std::vector<Sample*> ptrs and unordered_map mixer_index)**  
`server/src/audio/engine.cpp:895-898, 909-914, 921, 948` · Aufwand **M**  
render_one_block builds a std::unordered_map<std::string,std::size_t> mixer_index every block (895-898) and, per item, a fresh std::vector<Sample*> ptrs (909-914). Both allocate on the heap every ~5.3ms.  
*Fix:* Precompute mixer-id→index when the topology snapshot is built (store an integer index in the send entries instead of resolving by string each block). Replace the per-item std::vector<Sample*> with a reusable member buffer. Avoid…

**M-21 · [Performance] Render thread acquires the engine mutex up to three times per audio block, contending with control-thread mutations**  
`server/src/audio/engine.cpp:815, 873, 983` · Aufwand **L**  
render_loop gating takes std::lock_guard lock{mutex_} to read devices_.front() ring space (815); render_one_block takes it again to snapshot active_mixers + output_channel_gains_ (873-877);  
*Fix:* Fold active_mixers, output channel gains, and the device pointer list into the immutable atomically-published Topology snapshot so render_one_block reads only the snapshot. Reserve mutex_ for control-thread registry edits.

**M-22 · [Performance] /api/file/download reads the entire archive into a std::string in memory before sending**  
`server/src/net/control_server.cpp:1770-1793 (alloc/read at 1781-1782)` · Aufwand **M**  
The download handler opens the .lpa with std::ios::ate, reads size from tellg() (1779), allocates std::string body(size, '\0') (1781) and reads the whole file into RAM (1782) before constructing the response. Exported project archives include all media and can be hundreds of MB to several GB.  
*Fix:* Stream the file in chunks rather than materialising it in a single std::string. Cap or warn on very large archives.

**M-23 · [Architecture] Wire protocol relies on a fragile 'CORS-simple' hack instead of correct preflight handling**  
`client/app/composables/useLiveplayServer.ts:403-416; server/src/net/control_server.cpp:888-895` · Aufwand **S**  
The client (useLiveplayServer.ts:403-416) deliberately keeps every request CORS-simple: omits Content-Type on bodyless GET/DELETE and sends JSON bodies as text/plain;charset=UTF-8, with an extended code comment explaining that a JSON Content-Type would trigger an OPTIONS preflight the server's route 'doesn't cover…  
*Fix:* Make the OPTIONS handler reliably cover all /api/* paths and return proper CORS headers (verify Crow's <path> catch-all actually matches multi-segment at runtime, or add per-route OPTIONS), then drop the text/plain workaround.

**M-24 · [Architecture] useCartItems ↔ useProject circular auto-import; the workaround disables Vue Devtools and is TDZ-fragile**  
`client/app/composables/useCartItems.ts:3-14,35; client/app/composables/useProject.ts:611,679,772,881,959,1167; client/nuxt.config.ts:29-37` · Aufwand **M**  
useCartItems() calls const { currentProject } = useProject() at module body (useCartItems.ts:14), and useProject() calls useCartItems() in many flows (useProject.ts:611,679,772,881,959,1167,…), forming a bidirectional Nuxt auto-import cycle. useCartItems.ts:5-13 documents wrapping the shared map in useState…  
*Fix:* Move the shared cartOnlyItems state into a neutral leaf module (e.g. useCartStore with no useProject dependency) imported by both, as the nuxt.config comment itself suggests; then re-enable the timeline.

**M-25 · [Architecture] Five overlapping one-off Python locale scripts duplicate the same 21-language data with no shared source of truth**  
`scripts/add_all_missing_locales.py:1-720, scripts/add_dual_dialog_locales.py:1-562, scripts/add_missing_locales.py:1-110, scripts/add_repair_locales.py:1-165, scripts/add_server_unreachable_locale.py:1-51` · Aufwand **M**  
Confirmed: five separate Python scripts each hard-code locale data with embedded translation strings, plus two JS migration scripts (client/scripts/update-locales.mjs, client/scripts/add-play-next.mjs) in a third style. They share no helper code — each re-implements 'open every locale, mutate, write back'.  
*Fix:* Delete the five add_*.py and two .mjs migration scripts (git history preserves them). Keep en.json as single source of truth and sync-locale-keys.js as the only locale tool. If a future bulk-add needs native (non-English-fallback) values,…

**M-26 · [Architecture] useProject is a large god-composable mixing unrelated concerns**  
`client/app/composables/useProject.ts:1-1793+` · Aufwand **L**  
A single composable owns selection state, clipboard/duplicate, project file I/O, header hydration, paged item streaming, autosave gating, the repair/unsaved/delete dialog state machines, and the entire local->server diff engine (five debounced watchers + the inbound doc_patch applier). Much of it lives in a ~500-line…  
*Fix:* Extract cohesive units: useProjectSync (diff watchers + doc_patch applier + baselines), useProjectIO (open/create/save/close/stream), useProjectDialogs, and a pure selection module, with useProject as a thin facade.

**M-27 · [Code Quality] Three more oversized modules concentrate the system's complexity (control_server.cpp 2463, project_state.cpp 3332, main.js 3577)**  
`server/src/net/control_server.cpp (2463); server/src/core/project_state.cpp (3332); client/electron/main.js (3577); server/include/liveplay/core/project_state.hpp:405-422` · Aufwand **L**  
Confirmed by wc -l: control_server.cpp=2463, project_state.cpp=3332, main.js=3577. ProjectState owns a server-side sequencer on its own thread (project_state.hpp: sequencer_running_ at 405, start_sequencer/stop_sequencer/sequencer_loop/handle_item_ended/execute_custom_action at 407-411) alongside document storage,…  
*Fix:* Extract a Sequencer class owning its own thread/mutex and depending on engine + a read-only item view; move zip helpers, the download-token registry, and upload handling into util/net helpers.

**M-28 · [Code Quality] Massive duplication of playback-dispatch logic between useMidiController and useCartHotkeys (drift risk)**  
`client/app/composables/useMidiController.ts:137-239, client/app/composables/useCartHotkeys.ts:75-204` · Aufwand **M**  
dispatchDiscrete (MIDI, 137-239) and dispatchPlaybackAction (hotkeys, 134-204) implement the same pause-resume / toggle-loop / stop-all / select-up-down / play-selected / play-next semantics. The getTargetItem fallback chain (active cue -> findItemByUuid -> getCartOnlyItem -> selectedItem) is factored out in hotkeys…  
*Fix:* Extract a shared useControlActions() exposing getTargetItem() and dispatchAction(actionId); have both MIDI and keyboard call into it.

**M-29 · [Config/Secrets] Fork still publishes and identifies as the upstream repo**  
`package.json:7-14; client/package.json:5,94-98` · Aufwand **S**  
Root package.json author is 'Thomas Doukinitsas' (lines 7-10) and repository.url is https://github.com/tdoukinitsas/liveplay.git (line 13). client/package.json homepage is https://github.com/tdoukinitsas/liveplay (line 5) and electron-builder build.publish is provider github / owner tdoukinitsas / repo liveplay (lines…  
*Fix:* Repoint repository, author, homepage, and build.publish.owner/repo to the fork before any release build; verify the electron-updater feed URL.

**M-30 · [Config/Secrets] Package metadata, author, and publish/auto-update target still point at upstream (fork hygiene)**  
`package.json:6-13 (author/repository tdoukinitsas); client/package.json:26-29 (author), :94-98 (electron-builder publish owner/repo tdoukinitsas); client/electron/main.js:1682-1687 (autoUpdater.setFeedURL owner/repo tdoukinitsas); electron-updater dep at client/package.json:50` · Aufwand **S**  
Root package.json author = Thomas Doukinitsas and repository = github.com/tdoukinitsas/liveplay (lines 6-13). client/package.json author at 26-29, and electron-builder publish block at 94-98 = `provider github, owner tdoukinitsas, repo liveplay`.  
*Fix:* Update repository/author/homepage, the electron-builder publish.owner/repo, AND the hardcoded autoUpdater.setFeedURL in main.js to the fork's repo before any release that ships auto-update; or disable auto-update until the feed is correct.

**M-31 · [Config/Secrets] Real macOS crash report (73 KB) with hardware/display/network identifiers committed to repo root**  
`liveplay crash.txt:1-26,640-648` · Aufwand **S**  
A 73,704-byte Apple crash report for LivePlay 2.0.8 (Process LivePlay [80713], com.liveplay.app) sits at the repo root. It contains machine-identifying data: Hardware Model MacBookPro18,2 (line 16), Crash Reporter Key 88B226B7-69F5-7412-FE4C-62335FDC9119 (line 20), Incident Identifier BCFA26A7-...  
*Fix:* git rm the file (it persists in history; rewrite history only if the identifiers matter), file the crash as a GitHub issue, and add crash-dump patterns to .gitignore (*.crash, 'liveplay crash*.txt', *.ips, hs_err_pid*, core.*).

**M-32 · [Dependencies] http-proxy@^1.18.1 — legacy, effectively unmaintained core dependency on the LAN/tunnel data path**  
`client/package.json:54; client/electron/web-share.js:41 (require), :141 (createProxyServer), :169 (proxy.web), :201 (proxy.ws)` · Aufwand **M**  
client/package.json line 54 = http-proxy ^1.18.1. web-share.js requires it at line 41, creates the proxy at line 141 (`httpProxy.createProxyServer`), and forwards HTTP via `proxy.web` at line 169 and WebSocket upgrades via `proxy.ws` at line 201, targeting the local C++ control server.  
*Fix:* Migrate to a maintained successor (http-proxy-3 is near drop-in, or http-proxy-middleware) and re-test the WebSocket upgrade path and BasicAuth gating after migration.

**M-33 · [Dependencies] youtube-search-api + yt-dlp-wrap: unofficial, fragile, and legally fraught dependencies**  
`client/package.json:58-59; client/electron/main.js:7-8 (requires), :3131 (search-youtube IPC), :3152 (download-youtube-audio IPC)` · Aufwand **M**  
client/package.json line 58 = youtube-search-api ^2.0.1, line 59 = yt-dlp-wrap ^2.3.12. main.js line 7 requires youtube-search-api, line 8 requires yt-dlp-wrap.  
*Fix:* Gate behind a clearly-optional, off-by-default feature with a user-facing legal notice and defensive error handling so a broken scrape never blocks core playback. Reassess whether YouTube ingestion belongs in the shipped product.

**M-34 · [Dependencies] 372 .ttf font files (~104 MB working tree) committed, not gitignored, duplicated across four trees**  
`.gitignore:1-45; client/assets/fonts/, client/public/fonts/, docs-site/app/assets/fonts/, docs-site/public/fonts/` · Aufwand **M**  
git ls-files counts 372 tracked .ttf files totalling ~104 MB in the working tree, spread across four locations: client/assets/fonts (IBM Plex Mono x14, IBM Plex Sans x2+static x42), client/public/fonts (same + Inter x2+static x54), docs-site/app/assets/fonts and docs-site/public/fonts (IBM Plex Sans static x42 + Inter…  
*Fix:* De-duplicate to one canonical fonts dir per package, ship only the weights actually loaded (verify against @font-face), and gitignore public/fonts copies if they are build outputs. Consider git-lfs only if all weights are genuinely…

**M-35 · [CI/CD] Signing wiring is documented-only and inert; all released binaries are unsigned and un-notarized**  
`SIGNING.md:1-139; client/package.json:136; client/build/installer.nsh:15-20` · Aufwand **L**  
SIGNING.md states (lines 8-14) Windows (SignPath applied-for, not active), macOS (unsigned + un-notarized), and Linux artifacts are all unsigned, and the signing job exists only as a paste-me YAML snippet in the doc (lines 66-111), not in build-release.yml (verified: no signing step in the workflow).…  
*Fix:* Prioritize Windows Authenticode signing (SignPath wiring is staged) and macOS notarization. Until then, publish SHA-256 checksums of every released asset so users can verify downloads.

**M-36 · [CI/CD] Third-party actions pinned to mutable tags, not commit SHAs (supply-chain exposure)**  
`.github/workflows/build-release.yml:107,132,168,429; .github/workflows/build-server.yml:82,122; .github/workflows/deploy-docs.yml:32` · Aufwand **M**  
Confirmed all pins. build-release.yml: github-script@v7 (107), ilammy/msvc-dev-cmd@v1 (132), pnpm/action-setup@v4 (168), softprops/action-gh-release@v1 (429).  
*Fix:* Pin all third-party actions to full commit SHAs with a version comment; add .github/dependabot.yml (github-actions ecosystem) to bump them; upgrade softprops/action-gh-release to a current pinned SHA.

**M-37 · [CI/CD] No .dockerignore — entire repo (incl. node_modules, .git, server build artifacts) sent as build context**  
`deploy/Dockerfile:20, deploy/Dockerfile.caddy:16; missing .dockerignore at repo root` · Aufwand **S**  
Build context is the repository ROOT (compose files set `context: ..` / `context: ../..`; Dockerfile header lines 6-8 document this).  
*Fix:* Add a .dockerignore (repo root and/or client/) excluding node_modules, .git, .output, .nuxt, dist, *.env, server/build. At minimum ignore node_modules.

**M-38 · [Build reproducibility] No committed pnpm-lock.yaml exists anywhere in the repo, so CI cache keys and --frozen-lockfile are both inoperative**  
`.github/workflows/build-release.yml:183,213; .github/workflows/build-server.yml (n/a); repo root` · Aufwand **S**  
While verifying finding 4, confirmed via git ls-files and filesystem search that NO pnpm-lock.yaml is tracked or present at the repo root, client/, or docs-site/, and it is not gitignored. Consequently the pnpm-store and electron-builder cache keys in build-release.yml (lines 183 and 213) use…  
*Fix:* Generate and commit pnpm-lock.yaml; the existing hashFiles cache keys then become meaningful and --frozen-lockfile becomes adoptable.

**M-39 · [Tests] Smoke test exercises only --help; no runtime validation of the audio engine or HTTP control server**  
`.github/workflows/build-server.yml:148-160` · Aufwand **M**  
The C++ server's sole CI verification is liveplay-server --help exiting 0 (lines 148-151 non-Windows, 153-160 Windows). This proves the binary links and prints a banner.  
*Fix:* Add a CI step that boots the server on a port, curls a health/status endpoint and a representative control route, then shuts it down.

**M-40 · [Tests] God-modules are structured to be untestable, compounding the no-test risk**  
`server/src/core/project_state.cpp:1-3332, server/src/net/control_server.cpp:1-2463, client/app/composables/useProject.ts:1-1860, client/app/composables/useLiveplayServer.ts:1-1131, client/electron/main.js:1-3577` · Aufwand **M**  
Line counts confirmed exact (3332 / 2463 / 1860 / 1131 / 3577). These are by far the largest modules and concentrate parsing, business logic, I/O, networking, and side effects per file.  
*Fix:* When introducing the harness, extract pure decision logic into dependency-free units: a project-file (de)serializer over bytes+structs (no filesystem), path-sandbox validation as a pure function (already partially done in fs_sandbox.cpp —…

**M-41 · [Tooling/DX] No static analysis, linting, or formatting gate on either client or server**  
`client/package.json (scripts block — no lint/typecheck), server/CMakeLists.txt:33 (/W4 MSVC), server/CMakeLists.txt:41 (-Wall -Wextra -Wpedantic GCC/Clang), .github/workflows/build-release.yml, .github/workflows/build-server.yml` · Aufwand **M**  
No .eslintrc*/eslint.config.*/.prettierrc*/.clang-tidy/.clang-format anywhere outside node_modules. client/package.json has no lint or typecheck script.  
*Fix:* Add cheap gates that need no test-writing: (1) Server — CI matrix entries building with -fsanitize=address,undefined and a TSan build, driven by a scripted set of HTTP requests; add clang-tidy and turn on -Werror in CI. (2) Client — add…

**M-42 · [Observability] No global unhandledRejection / uncaughtException handlers in the main process**  
`client/electron/main.js (no process.on('unhandledRejection'|'uncaughtException') anywhere; bare async inits at 1430-1431)` · Aufwand **S**  
grep for process.on / unhandledRejection / uncaughtException in main.js returns nothing. The main process runs many fire-and-forget async operations (initializeYtDlp()/initializeDeno() bare at 1430-1431, autoUpdater promises, dgram callbacks, web-share teardown).  
*Fix:* Add process.on('unhandledRejection') and 'uncaughtException' handlers that log to a file under userData and degrade gracefully; consider crash reporting.

**M-43 · [Accessibility] Interactive list rows and tabs are click-only <li>/<div>, not keyboard-operable**  
`client/app/components/ServerFileBrowser.vue:21-31; client/app/components/ServerFilePickerModal.vue:33-44; client/app/components/AudioImportModal.vue:37-44,66-73; client/app/components/YouTubeImportModal.vue:46-72` · Aufwand **M**  
Confirmed with one nuance. ServerFileBrowser.vue:21-31 and ServerFilePickerModal.vue:33-44 render entries as `<li @click @dblclick>` with no tabindex/role/keydown — entire navigation and Ctrl/Shift multi-select (ServerFileBrowser onEntryClick 136-159) is mouse-only.  
*Fix:* Render activatable rows as <button> or add role + tabindex + @keydown.enter/space; expose list containers as listbox/grid with proper roles; provide keyboard equivalents for range/multi-select.

**M-44 · [Accessibility] Modals lack focus trapping, ARIA roles, and consistent keyboard dismissal**  
`client/app/components/YouTubeImportModal.vue:2; client/app/components/WebShareModal.vue:12; client/app/components/AudioImportModal.vue:3; client/app/components/ServerFilePickerModal.vue:3; client/app/components/AboutModal.vue:146-156` · Aufwand **M**  
The overlay roots are plain divs: YouTubeImportModal.vue:2 `<div class="modal-overlay" @click.self="closeModal">`, WebShareModal.vue:12 `<div class="modal-overlay" @click.self="close">`, AudioImportModal.vue:3 `<div class="modal-backdrop" @click.self="close">`, ServerFilePickerModal.vue:3 `<div class="picker-backdrop"…  
*Fix:* Add a shared modal wrapper/composable providing role/aria-modal/aria-labelledby, initial focus, focus trap, and Escape handling; apply to all overlays.

**M-45 · [Documentation] No architecture documentation / ADRs for a non-obvious client↔server split and dual build**  
`repo root (README.md, SIGNING.md) and docs/ (all web-hosting how-tos)` · Aufwand **S**  
Root contains only README.md and SIGNING.md. docs/ contains only operational how-tos (web-hosting.md, web-sharing-stable-url.md, web-hosting-inapp-mac.md, web-client-hosting-auftrag.md, debugging-mac.md, test-build-release-mac.md).  
*Fix:* Add docs/architecture.md plus a few ADRs (out-of-process engine; sync/echo-suppression; web hosting modes; security/auth posture). Low effort, high leverage.

**M-46 · [Documentation] AGPL §13 network source-offer not reachable in the served web UI (About dialog is Electron-menu-only)**  
`client/app/app.vue:309-310,47; client/app/components/AboutModal.vue:51-67; README.md:524-526; deploy/README.md:45-53` · Aufwand **M**  
Partially confirmed with an important correction. A source-offer affordance DOES exist in code: AboutModal.vue:51-58 renders a 'GitHub Repo' link and lines 60-67 an AGPL-3.0 license link.  
*Fix:* Make the About/source link reachable in the web target (a header/footer button, not only the Electron menu), point it at the fork's exact source/commit, and add an AGPL §13 compliance note to README and deploy/README for anyone hosting the…

**M-47 · [Documentation] Internal German work-order doc with live exploit analysis, endpoint list, unfixed bug and internal branch name shipped in public docs/**  
`docs/web-client-hosting-auftrag.md:73-92,160-163,254-265` · Aufwand **S**  
docs/web-client-hosting-auftrag.md (324 lines) is an internal 'Arbeitsauftrag' + audit. Lines 254-265 spell out the open CORS '*' + no-auth condition and explicitly describe a CSRF-style vector from any website the victim opens, granting filesystem read/write.  
*Fix:* Move it out of the published docs/ tree (issue/wiki/private notes). If a public security note is needed, replace it with a hardened SECURITY.md stating threat model + mitigations without enumerating live exploit vectors, unfixed bugs, or…

**M-48 · [Documentation] README and sub-READMEs say 'Nuxt 3' but the project (and docs-site) is Nuxt 4**  
`README.md:97,262,268; client/README.md:3,33; docs-site/README.md:3,11,27; client/package.json:37; docs-site/package.json:13` · Aufwand **S**  
client/package.json:37 pins nuxt ^4.4.7 and docs-site/package.json:13 ALSO pins nuxt ^4.4.7. Yet README.md:97 (architecture diagram), :262 and :268 say 'Nuxt 3';  
*Fix:* Global replace 'Nuxt 3' -> 'Nuxt 4' across README.md, client/README.md, and docs-site/README.md (docs-site is verified on 4).

**M-49 · [Security] Crash logs and crash-resume file written to predictable, world-readable locations next to project/exe**  
`server/src/crash_handler.cpp:84-100,239-273,461-467; server/src/main.cpp:459,467-488` · Aufwand **M**  
Crash logs go to <project_dir>/logs or exe_dir/crash-logs with no explicit mode (umask 0644, world-readable) and embed the full session history — client IPs, full project paths, and verbatim WebSocket bodies. .crash-resume.json (absolute project path) is written next to the exe and consumed on next start.  
*Fix:* Create logs/resume with 0600/owner-only ACLs; write crash-resume to a per-user state dir (XDG_STATE_HOME/%LOCALAPPDATA%) not next to the shared exe, and verify owner before consuming; redact raw WS bodies/client IPs from persisted history.

**M-50 · [Security] Crash-restart forks and execs a /bin/sh command string from the crashing process**  
`server/src/crash_handler.cpp:300-316,277-298; server/src/main.cpp:449-455` · Aufwand **M**  
On crash a forked child runs execl("/bin/sh","sh","-c",cmd) with cmd = exe_path + " " + g_restart_args (the verbatim joined argv). fork() from a corrupted/crashed address space can deadlock before exec (locks held by other threads are never released), and routing through /bin/sh -c means shell metacharacters in args…  
*Fix:* Exec the binary directly with a preserved argv vector (no /bin/sh, no re-join into a string). Better: restart from a separate supervisor/watchdog that was never part of the crashed address space.

**M-51 · [Security] Discovery beacon broadcasts hostname and open project name to the whole LAN, unauthenticated**  
`server/src/net/discovery.cpp:276-311,59-68; server/src/core/project_state.cpp:1433` · Aufwand **S**  
Every 3s the beacon broadcasts (subnet broadcast + 255.255.255.255 + multicast 239.255.69.80) a cleartext JSON payload with the OS hostname, the open project's display name, hasOpenProject, itemCount, and exact server version, to anyone on the LAN with no auth and no opt-out short of disabling discovery.  
*Fix:* Advertise only what the client needs to connect (port + opaque instanceId). Drop hostname/projectName from the broadcast or gate behind opt-in; if a display name is needed, send it only on the unicast solicit-reply to an on-link asker and…

**M-52 · [Security] Pidfile written without O_EXCL / O_NOFOLLOW (symlink TOCTOU + follow)**  
`server/src/main.cpp:611-633,757-760` · Aufwand **S**  
The --pidfile path is opened with a plain truncating std::ofstream (no O_EXCL/O_NOFOLLOW/mode) and removed unconditionally on shutdown (also follows symlinks). A pre-created symlink at a predictable pidfile path causes the open to follow it and truncate the target;  
*Fix:* Open with O_CREAT|O_EXCL|O_NOFOLLOW mode 0600 (or pre-check it is a regular non-symlink file); on shutdown remove only after confirming it still holds our PID; place it in a per-user runtime dir, not a shared temp location.

**M-53 · [Security] Unauthenticated log injection via WebSocket/REST into the in-memory log and crash report**  
`server/src/logger.cpp:188-213,66-79; server/src/net/control_server.cpp:705` · Aufwand **S**  
Logger::log() does not neutralize CR/LF or control bytes (strip_ansi only removes ANSI CSI). The raw WS message body is logged verbatim (as a format argument, so no format-string bug) but unsanitized, so an unauthenticated LAN client can inject newlines to forge fake log lines that then get embedded in the crash-log…  
*Fix:* Escape/strip CR/LF and non-printable bytes before pushing to the ring buffer and the stream; cap the logged length of externally-sourced strings (e.g. truncate WS bodies to ~256 bytes for logging).

---

## ⚪ Low Findings

Compact log of lower-impact robustness, quality, accessibility and minor-correctness items (all verified against source).

| ID | Kategorie | Befund | Ort | Empfehlung | Aufw. |
|---|---|---|---|---|---|
| L-01 | Security | build-server-app-mac.js builds shell command strings with interpolated paths and an… | `scripts/build-server-app-mac.js:47, 58, 67-78, 123, 133, 141,…` | Replace execSync('rm -rf ...') with fs.rmSync(p, {recursive:true, force:true}) (already used in build-clean.js:20), chmod via fs.chmodSync. Use… | M |
| L-02 | Security | REST layer sends JSON as text/plain to avoid CORS preflight; server is wide-open CORS… | `client/app/composables/useLiveplayServer.ts:399-445;…` | Add a real auth token / Origin allowlist on the server's mutating endpoints rather than relying on preflight, and document that the web deployment… | M |
| L-03 | Security | Multipart upload writes arbitrary content/extensions into media_root with no type or… | `server/src/net/control_server.cpp:1352-1374 (upload),…` | Restrict uploaded extensions to audio_extensions() plus expected project types, enforce a per-file size cap, and confirm media_root resolves inside… | S |
| L-04 | Security | Orphaned export temp files are never reclaimed; download tokens are non-cryptographic | `server/src/net/control_server.cpp:259-289 (token mgmt),…` | Run the expired-token GC (and delete the backing temp file) on a timer, not only on redeem. Apply a TTL-based temp-file sweep regardless of… | S |
| L-05 | Security | Zip extraction containment guard is a substring '..' test, not a path-component… | `server/src/net/control_server.cpp:205-246 (zip_extract_to),…` | After computing dest, normalise and verify containment against out_dir component-wise (reuse FsSandbox/path_within) instead of the substring test.… | S |
| L-06 | Security | Multipart /api/upload writes attacker-named files straight into the project media root… | `server/src/net/control_server.cpp:1338-1375` | Require the same loopback/same-origin gate suggested for project/load, or refuse to overwrite an existing media file (write to a unique name) so an… | S |
| L-07 | Security | normalise() silently falls back to lexically_normal when weakly_canonical fails,… | `server/src/util/fs_sandbox.cpp:29-34` | On weakly_canonical failure, fail closed (return empty so authorize() returns nullopt → 403) rather than falling back to lexically_normal, or accept… | S |
| L-08 | Security | path_within treats an empty base (or empty leading component) as matching everything | `server/src/util/fs_sandbox.cpp:56-68` | At the top of path_within, return false if base.empty(); also reject a base whose first iterated component is empty rather than treating it as a full… | S |
| L-09 | Security | Caddy reverse proxy and nginx set no security headers and no upstream timeouts/health | `deploy/Caddyfile:18-30, deploy/nginx.conf:5-22` | Add a Caddy `header` directive (nosniff, frame-ancestors none/X-Frame-Options DENY, Referrer-Policy, HSTS on HTTPS) and reverse_proxy dial/read… | S |
| L-10 | Security | nginx and Caddy containers run as root; no container hardening directives | `deploy/Dockerfile:29-32, deploy/Dockerfile.caddy:22-25,…` | Add a non-root USER (unprivileged nginx variant or chown + listen >1024) and in compose add `read_only: true` + tmpfs, `cap_drop: [ALL]`,… | M |
| L-11 | Security | State-viewer window loads interpolated HTML via a data: URL and inserts state keys… | `client/electron/main.js:1933 (createStateViewerWindow),…` | Escape keys as well as values (or build the DOM with textContent), and prefer a packaged local file with a CSP over a data: URL. | S |
| L-12 | Security | Named-tunnel ingress config written world-readable to a predictable temp path | `client/electron/web-share.js:432-445,447-452` | Write with mode 0o600 and/or use fs.mkdtemp for a private dir; consider O_EXCL creation to avoid pre-created-path attacks. | S |
| L-13 | Correctness | ensure-server.js stale-server kill targets ANY process bound to the port, not just… | `scripts/ensure-server.js:67-85` | Before killing, confirm the PID's executable basename is liveplay-server (read /proc/<pid>/comm on Linux, ps -p <pid> -o comm= elsewhere) and skip… | S |
| L-14 | Correctness | WaveformCanvas does not redraw on durationSec/color changes and risks division-by-zero on… | `client/app/components/WaveformCanvas.vue:106,134-142,158-159` | Add watch(() => [props.durationSec, props.color, props.rmsColor], draw) and guard buckets > 0 before drawing a channel. | S |
| L-15 | Correctness | Repair/unsaved/delete dialog promise resolvers can leak or double-resolve | `client/app/composables/useProject.ts:655-662,1765-1788` | Reject/settle any outstanding resolver before opening a new dialog, and ignore re-entrant opens while one is pending. | S |
| L-16 | Correctness | Cart-slot key conflicts between cart slots and playback actions are not bidirectionally… | `client/app/composables/useCartHotkeys.ts:228-242,244-268,206-2…` | Make updateBinding also check playbackMappings and report the conflict, mirroring updatePlaybackBinding. | S |
| L-17 | Correctness | MIDI Learn capture has no cleanup if the learning component unmounts mid-capture | `client/app/composables/useMidiController.ts:102,104,285-290,41…` | Call stopLearn() in the config modal's onBeforeUnmount and on any modal close/dismiss; optionally add a learn timeout that auto-cancels. | S |
| L-18 | Correctness | MIDI listeners are leaked on hot-plug: onstatechange re-attaches handlers without ever… | `client/app/composables/useMidiController.ts:336-341,358-362,46…` | If multi-consumer use is ever introduced, refcount the singleton instead of a boolean mounted flag, and have unmount only detach when the last owner… | M |
| L-19 | Correctness | MIDI master-volume reference value (lastMasterVolumeRaw) is module-global and never… | `client/app/composables/useMidiController.ts:107,251-261` | Reset lastMasterVolumeRaw = null in onstatechange and in setPreferredDevice. Optionally key the reference per device/source name. | S |
| L-20 | Correctness | applyVolumeOffset / dbToLinear floor at -60 dB is applied silently even though the app… | `client/app/utils/audio.ts:20-23,32-35,45-57` | Centralize the -60 floor constant; consider lowering/removing the hard floor or documenting the post-offset effective mute point (~-50 dB UI). | S |
| L-21 | Correctness | handleMidiMessage device filtering relies on (event.target as any).name with no fallback… | `client/app/composables/useMidiController.ts:272-276` | If preferredDevice is not present in connectedDevices, fall back to accepting all devices or surface a clear 'preferred MIDI device not connected'… | S |
| L-22 | Correctness | i18n placeholder substitution only replaces first occurrence and has no… | `client/app/composables/useLocalization.ts:90-95` | Use a global regex replace (new RegExp('\\{'+param+'\\}','g')) and optionally warn in dev when an unresolved {token} remains. | S |
| L-23 | Correctness | useStateViewer interval is a module-level singleton shared across all instances;… | `client/app/composables/useStateViewer.ts:4,12-17,71-94` | Use onScopeDispose for instance-scoped lifecycle or document the singleton; build the serializable state once instead of double-stringifying. | S |
| L-24 | Correctness | Unused constexpr db_to_linear() in types.hpp is a wildly inaccurate 4-term Taylor… | `server/include/liveplay/audio/types.hpp:70-80` | Delete the constexpr helper (or alias it to db_to_linear_precise). If a constexpr path is genuinely needed, implement a correct exp. | S |
| L-25 | Correctness | gen_uuid_like() is a 64-bit RNG + counter, not a real UUID; collision/predictability risk… | `server/src/audio/engine.cpp:30-42` | Use a 128-bit UUIDv4, or check-before-insert and regenerate on collision; reject duplicate requested_id on load. | S |
| L-26 | Correctness | Integer overflow in duration computation (frames * 1000) | `server/src/meta/waveform.cpp:122-124;…` | Validate total_frames and sample_rate ranges before computing; divide before multiplying (frames/sample_rate*1000 with remainder handling) or use… | S |
| L-27 | Correctness | noexcept on compute_waveform turns std::bad_alloc into std::terminate | `server/src/meta/waveform.cpp:16-17;…` | Bound the allocations (per finding 1) so bad_alloc cannot realistically occur, and/or wrap the allocation/decode body of compute_waveform in… | S |
| L-28 | Correctness | apply_to_engine_locked dereferences engine_.find_cue() without null check | `server/src/core/project_state.cpp:2954-2965…` | Capture PlaybackItem* pi = engine_.find_cue(id) once and null-check before calling setters, matching the mixer block at 2974. | S |
| L-29 | Correctness | liveplay-server:restart uses a fixed 500ms delay; the SIGKILL timer is never cleared and… | `client/electron/main.js:727-732 (restart), 636-661…` | Await server exit / poll port-free before restart; clearTimeout(liveplayServerExitTimer) on clean exit and at the start of the next stop. | S |
| L-30 | Correctness | Production catch-all sends index.html for every unmatched path including failed asset… | `client/electron/web-share.js:178-181` | Return 404 for unmatched asset paths (e.g. /_nuxt/ or known extensions); only fall through to index.html for navigation (Accept: text/html) requests.… | S |
| L-31 | Robustness | build-clean.js moves vcpkg_installed via fs.renameSync, which fails across… | `scripts/build-clean.js:33-43` | Wrap rename/restore in try/catch and fall back to recursive copy (or skip the preserve optimization, letting vcpkg rebuild) on EXDEV. On startup also… | S |
| L-32 | Robustness | build-server-app-mac.js hardcodes CFBundleVersion/CFBundleShortVersionString to 2.0.0,… | `scripts/build-server-app-mac.js:104,106` | Read the version from package.json at build time (require('../package.json').version or read REPO_ROOT/package.json) and interpolate into the plist,… | S |
| L-33 | Robustness | version.js performs no existence check, no verification the replace matched, and is not… | `scripts/version.js:63-96` | In updateVueFile, assert the regex matched (compare before/after content, throw if unchanged so the ✓ isn't printed on a no-op). In setVersion,… | S |
| L-34 | Robustness | render_one_block trusts an unguarded invariant that topo.masters.size() ==… | `server/src/audio/engine.cpp:945-953, 957-976, 996-1005` | Bound the master loops by std::min(cfg_.master_channels, topo.masters.size()) and assert equality in debug builds. | S |
| L-35 | Robustness | Authorized paths are read/written with unbounded/uncapped filesystem calls that can block… | `server/src/net/control_server.cpp:1289-1311 (fs/list,…` | Use std::error_code overloads consistently, reject non-regular files (FIFO/device/socket) before reading on POSIX, cap sizes for read/copy/download,… | M |
| L-36 | Concurrency | Detached priming thread in play_item can outlive a project reset and use freed engine… | `server/src/core/project_state.cpp:2218-2222 (detached priming…` | Avoid detaching: prime synchronously, track the threads for join on reset(), or prime inside the engine under its own lock holding the shared_ptr so… | M |
| L-37 | Performance | ensure-server.js freshness check walks the entire server tree on every dev launch with no… | `scripts/ensure-server.js:34-51` | Acceptable as a heuristic; document the branch-switch limitation. Consider always invoking `cmake --build` (incremental and authoritative via CMake's… | M |
| L-38 | Performance | Meter IIR state lacks denormal protection during silent tails (limiter sub-claim partly… | `server/src/audio/meter.cpp:61-80,…` | Enable FTZ/DAZ at render_loop start (_MM_SET_FLUSH_ZERO_MODE / _MM_SET_DENORMALS_ZERO_MODE on x86), or add an anti-denormal flush when \|state\| <… | S |
| L-39 | Architecture | External 'http-request' custom action is delegated to whichever client happens to be… | `server/include/liveplay/core/project_state.hpp:413-419;…` | Elect a single deterministic executor (e.g. host/local client only) or perform the request server-side behind an allow-list; document the contract… | M |
| L-40 | Code Quality | build-all.js / build-clean.js conditionally enable shell:true for spawnSync on Windows,… | `scripts/build-all.js:24, scripts/build-clean.js:50` | Avoid shell:true. The only reason for it is resolving pnpm.cmd on Windows; resolve the binary explicitly (pnpm vs pnpm.cmd) and keep shell:false, or… | S |
| L-41 | Code Quality | Heavy duplication between ServerFileBrowser and ServerFilePickerModal | `client/app/components/ServerFileBrowser.vue:95-178;…` | Extract a useServerFileBrowser composable for listing/navigation/sort/format/selection consumed by both, or collapse to one configurable component. | M |
| L-42 | Code Quality | YouTubeImportModal: oversized download/import logic in a presentation component,… | `client/app/components/YouTubeImportModal.vue:52,167-306,265-27…` | Move download/import/waveform logic into a useYouTubeImport composable; add a timeout to getAudioDuration; remove the project console.logs;… | M |
| L-43 | Code Quality | WS singleton is never torn down; reconnect timers and connection survive app teardown | `client/app/composables/useLiveplayServer.ts:60-65,194-202,1011…` | Call server.destroy() from the plugin's app:unmount / onScopeDispose, and have scheduleReconnect bail if a destroy flag is set. | S |
| L-44 | Code Quality | Master limiter is fully bypassed when disabled, changing path latency and leaving a stale… | `server/src/audio/engine.cpp:970-976,…` | Either always run the limiter with gain pinned to unity when 'disabled' so latency stays constant, or call limiter->reset() and crossfade on toggle.… | S |
| L-45 | Code Quality | prime() holds decoder_mutex_ and does blocking disk I/O; render_block try_lock emits… | `server/src/audio/playback_item.cpp:314-367, 418-419` | Early-return false from prime() when transport is Playing/FadingIn, or prime via a separate decoder handle that does not contend with the live… | S |
| L-46 | Code Quality | Most preload ipcRenderer.on helpers expose no unsubscribe — listener leaks and possible… | `client/electron/preload.js:85-96 (onMenu*), 116-120…` | Make every onX helper wrap the listener and return a disposer (as the server/webShare/app/discovery ones do); have components dispose on unmount. | M |
| L-47 | Input Validation | setServerUrl persists arbitrary user URL to localStorage and immediately connects without… | `client/app/composables/useLiveplayServer.ts:78-117` | Validate the URL is http(s) with a parseable host before storing/connecting; fall back to the loopback default and surface an error otherwise. | S |
| L-48 | Config/Secrets | Mode A compose publishes 443 but the homelab default never serves TLS on it | `deploy/docker-compose.mode-a-caddy.yml:20,24-26,…` | Comment out `443:443` in the default file or gate it behind the hostname instructions, making clear it is only needed once LIVEPLAY_SITE_ADDR is a… | S |
| L-49 | Config/Secrets | Traefik file-provider config hardcodes a LAN IP and proxies plaintext to the open server… | `deploy/traefik/liveplay-dynamic.yml:19,33,…` | Template the upstream URL and Host via env/generated dynamic file, add a loadBalancer healthCheck, and pair with the basicAuth middleware from… | M |
| L-50 | Dependencies | express@^4.18.2 — Express 4 EOL track; v5 is current/recommended | `client/package.json:51; client/electron/web-share.js:40…` | Plan a migration to express@5 (or the built-in node http server, which the app already uses elsewhere). Low urgency; track it. | M |
| L-51 | Dependencies | fluent-ffmpeg@^2.1.3 — unmaintained wrapper used for audio processing | `client/package.json:53; client/electron/main.js:9 (require);…` | Invoke ffmpeg directly via child_process with a fixed argv array (no shell string interpolation), or move to a maintained wrapper. Audit that no… | M |
| L-52 | Dependencies | uuid@^9.0.1 and archiver@^7.0.1 — minor currency / floating ranges | `client/package.json:47 (archiver ^7.0.1), :57 (uuid ^9.0.1);…` | Bump uuid when convenient. Higher-value action is committing the lockfile so archiver's transitive tree is pinned (see lockfile finding). | S |
| L-53 | Dependencies | vcpkg uses a single builtin-baseline with version>= floors — server deps not exactly… | `server/vcpkg.json:8-30 (dependencies with version>=), :30…` | Keep the baseline and add explicit version overrides for the security-sensitive parsers (crow, taglib, miniz) so baseline bumps don't silently change… | S |
| L-54 | Dependencies | Base images are unpinned floating tags — non-reproducible builds, silent base drift | `deploy/Dockerfile:12,29, deploy/Dockerfile.caddy:12,22` | Pin base images by digest or full patch tag, and pair with a committed lockfile + `npm ci`. Document pinned versions. | M |
| L-55 | CI/CD | Release job does not pin its build inputs to the released tag / version mismatch risk | `.github/workflows/build-release.yml:16-47,264-274,400-410,428-…` | Have the release job check out the exact SHA build ran against (pass github.sha as an output), fail fast if the tag already exists, and special-case… | M |
| L-56 | CI/CD | deploy-docs deploy job lacks environment protection and installs with… | `.github/workflows/deploy-docs.yml:14-21,39-44,62-69` | Commit a lockfile and switch to --frozen-lockfile, add a github-pages environment to the deploy job, and SHA-pin actions/deploy-pages and… | S |
| L-57 | CI/CD | electron:build retried up to 3x without cleaning partial output (non-idempotent retry) | `.github/workflows/build-release.yml:217-235,237-255` | rm -rf client/dist-electron at the start of each retry attempt so only the final successful build's output is ever collected. | S |
| L-58 | Tests | build pipeline and locale scripts have no tests, no CI lint, and no schema/placeholder… | `scripts/ (whole directory)` | Add a lightweight CI check loading every client/locales/*.json: assert valid JSON, assert key-set parity with en.json (extend sync-locale-keys.js… | M |
| L-59 | Tooling/DX | Four Python locale scripts write JSON without a trailing newline, fighting the newline… | `scripts/add_all_missing_locales.py:719,…` | Add f.write('\n') after each json.dump in the four scripts, or delete them per the consolidation finding. Better: route all locale writes through one… | S |
| L-60 | Tooling/DX | setup-docs-site.ps1 runs 'npm install' inside docs-site, contradicting the documented… | `setup-docs-site.ps1:16; README.md:67,295-307` | Change the script to pnpm install (or pnpm --filter ./docs-site install), or delete it if docs-site is covered by root pnpm install; document it in… | S |
| L-61 | Observability | No HEALTHCHECK or compose healthcheck — orchestrator cannot detect a wedged web container | `deploy/Dockerfile:1-33, deploy/Dockerfile.caddy:1-26,…` | Add a HEALTHCHECK (e.g. `wget -qO- http://localhost/ \|\| exit 1`) to each runtime stage or a compose `healthcheck` hitting /index.html. | S |
| L-62 | Documentation | 10 print-resolution PDF icon masters committed as source assets across three trees | `client/assets/icons/PDF/ (6 files),…` | Keep one canonical copy of the design masters (or move to a design-assets branch/location), remove the duplicated public/ copies, and gitignore… | S |
| L-63 | Documentation | License file named LICENCE.txt (British spelling) — GitHub/SPDX tooling will not… | `LICENCE.txt:1; README.md:277,526; client/package.json:30;…` | Rename to LICENSE (or add a LICENSE copy/symlink) and update the two README references (lines 277, 526). | S |
| L-64 | Documentation | README locale-count says 20 but 21 locale files exist; no automated tests cover the… | `README.md:30,504; scripts/README.md:49; client/locales/` | Fix the count to 21 in README.md:30,504. Add smoke/integration tests for the fork-added security surface (PIN/BasicAuth gate, filesystem sandbox… | M |
| L-65 | Resource leaks | enumerate_devices / open_device_by_name re-init a ma_context per call | `server/src/audio/engine.cpp:183-214, 310-338` | Hold a single long-lived ma_context in the engine and reuse it for enumeration and device opening. | M |
| L-66 | Correctness | Crash-resume global string state written with strncpy from non-signal threads, read in… | `server/src/crash_handler.cpp:451-467,257-273;…` | Double-buffer the resume state behind an atomic index/sequence (write inactive slot, publish via atomic release store) so the handler always reads a… | M |
| L-67 | Correctness | Interface enumeration computes a malformed directed broadcast for /31, /32 and PPP/VPN… | `server/src/net/discovery.cpp:126-131,142-150,138-140` | Skip interfaces without IFF_BROADCAST / with IFF_POINTOPOINT and prefixes >=31; only push a directed broadcast when it differs from both the… | S |
| L-68 | Robustness | Startup port-conflict 'kill existing' path kills a PID parsed from lsof with a TOCTOU… | `server/src/main.cpp:330-344,509-544,300-326` | Kill only a process the pidfile vouches for; re-confirm the PID still holds the port immediately before SIGKILL; avoid depending on an external lsof… | M |
| L-69 | Robustness | console_ctrl_handler sleeps 4.5s inside the handler, racing Windows' kill timer instead… | `server/src/main.cpp:80-89,692,748-756` | Signal shutdown and wait on an event the main thread sets once cleanup completes (timeout just under the kill window); bound server->stop() join time… | M |
| L-70 | Observability | Logger ring buffer has unbounded per-line size and there is no durable/rotating log sink | `server/src/logger.cpp:38-58,215-233` | Add an optional size/age-rotated rolling file sink written incrementally under the existing mutex; bound per-line length on push; right-size or… | M |
---

## Was fehlt? — Systemic gaps ("what's missing")

These are absences rather than defects in existing code — the layers a state-of-the-art project of this shape would have, ordered by leverage.

### 1. A security/trust model (the biggest gap)
- **No authentication or pairing** on the control plane (REST + `/ws`), the Electron express API, or the UDP discovery handshake. The `FsSandbox` is the *only* access control and it is bypassed by one route (H-09). There is no token, no per-client identity, no "trusted local client vs arbitrary LAN peer" distinction.
- **No transport security** for non-loopback use beyond an external reverse proxy; the discovery beacon advertises an unauthenticated endpoint in cleartext.
- **No request limits**: no `max_payload`, no rate limiting, no connection cap, no body-size gate before buffering, no bound on `doc_patch`/meter broadcast fan-out (each new WS client triggers a snapshot under locks).
- **No `SECURITY.md` / documented threat model**, despite the README and an internal work-order doc both acknowledging the open surface. Security knowledge is scattered, including a public `docs/web-client-hosting-auftrag.md` that *enumerates live exploit vectors* (M-47).
- **No input-schema validation** of project documents / wire messages on either side — both the C++ server and the TS client trust the shape of JSON from the network, clipboard, and `.lpa` import.

### 2. Tests (there are none)
- **Zero automated tests** of any kind: no Vitest/Jest/Playwright on the client, no CTest/GTest/doctest/Catch2 on the server, no `test` script anywhere. The only "test" in CI is `liveplay-server --help`.
- Highest-value missing suites: **`FsSandbox` path-traversal** (the security boundary), **project `.lpa`/`.liveplay` save/load/import round-trips** (the data-loss boundary), **the `useProject` sync/`isHydrating`/diff engine** (the documented-historically-buggy state machine), **audio math** (limiter ceiling, meter ballistics, LTC bit/parity encoding, fade envelopes), and a **happy-path integration test** (spawn → load → play → stop).
- **No sanitizer builds** (ASan/UBSan/TSan) for a real-time, multi-threaded C++ engine — exactly the bug class (the H-14 use-after-free, the M-21 mutex contention) most likely to crash a show.
- **No regression-fixture corpus** of real project files / hostile media to guard parser regressions as the fork diverges from upstream.

### 3. CI/CD & reproducibility
- **No quality gates** (lint, type-check, tests) anywhere — CI builds and publishes a public release with nothing in between (H-23).
- **No committed lockfile** (`pnpm-lock.yaml`) → non-reproducible builds, inert cache keys, `--frozen-lockfile` impossible (M-38). `vcpkg` uses `version>=` floors with no per-package overrides for the security-sensitive parsers (crow/taglib/miniz).
- **No supply-chain hardening**: third-party actions pinned to mutable tags not SHAs (M-36); no Dependabot/Renovate; no SBOM, provenance/attestation, or published checksums; **no code signing/notarization active** on any platform (M-35); no secret-scanning/SAST (CodeQL).
- **No image CI** (hadolint/trivy/dockle/build smoke) — which is why the build-breaking `COPY` (C-03) shipped.

### 4. Observability & operations
- **No durable log** on the server — the in-memory ring is lost on any non-crash exit (M-53); no rotating file sink, metrics, or tracing. The crash handler that should capture the worst cases is itself unsafe (H-26).
- **No global `unhandledRejection`/`uncaughtException` handlers** in the Electron main process (M-42); failures during a show leave no diagnostics.
- **No operator-visible status** for MIDI activity, device presence, sync health, dropped audio frames, or "last save failed" (the M-17 bug can even show "saved" on a failed write).
- **No error surfacing** in client import/export flows — failures are `console.error`-only and silent to the operator prepping a show.

### 5. Architecture & maintainability
- **No ADRs / architecture doc** for a non-obvious out-of-process split, dual Electron/web build, sync/echo-suppression invariants, and the security posture — all rationale lives in inline comments (M-45).
- **No shared protocol/schema** between client and server (hand-maintained TS DTOs vs C++ JSON, no contract test).
- **God-modules** (`main.js`, `project_state.cpp`, `control_server.cpp`, `useProject.ts`) concentrate parsing + business logic + I/O + side effects, making them untestable and high-churn (H-22, M-26/27/40).
- **No `CONTRIBUTING.md`/`CODE_OF_CONDUCT.md`/issue templates/CHANGELOG** for the fork; the fork has no tags so auto-generated changelogs are empty.

### 6. Licensing & fork hygiene
- **Fork identity not repointed** (publish/feed/homepage/author → upstream) — the root of C-02 and M-29/30.
- **No AGPL §13 network source-offer** reachable from the served web UI (the fork's flagship feature) — a compliance gap (M-46).
- **No SBOM / bundled-binary license inventory** despite shipping ffmpeg, yt-dlp, cloudflared, TagLib, Crow under AGPL.
- **Repo hygiene**: a real 73 KB crash dump (M-31) and **372 `.ttf` fonts (~104 MB, triplicated)** + 10 print PDFs committed (M-34, L-table); `.gitignore` lacks crash-dump/generated-asset patterns.

---

## Appendix A — Coverage map

| Area | What was read | Findings |
|---|---|---|
| Architecture & boundaries | configs, plugin, `useProject`/`useLiveplayServer`, server entry + key headers | C-01/02, H-09/22, M-23/24/27/45 |
| Electron main (3,577 LOC) | `main.js`, `preload*.js` | C-01/02, H-01/02/03/04/13, M-08/18/42, L |
| Web-share + tunnel | `web-share.js` | H-05/06/07, M-09/19, L |
| C++ control server (2,463 LOC) | `control_server.{cpp,hpp}` | C-01, H-08/09/11/14/21, M-22, L |
| Filesystem sandbox | `fs_sandbox.cpp`, `unicode_path.hpp` | H-09/10, M-03/06/15, L |
| Project state + `.lpa` (3,332 LOC) | `project_state.{cpp,hpp}`, `backup_manager.*` | H-11/15, M-05/16/17, L |
| Real-time audio engine | `engine/mixer/limiter/meter/ltc/playback_item` (+headers, `miniaudio_impl.c`) | H-16, M-14/20/21, L |
| Metadata & waveform | `metadata.cpp`, `waveform.cpp` | H-20/21, M-04, L |
| Bootstrap / crash / logger / **UDP discovery** | `main.cpp`, `crash_handler.*`, `logger.*`, `discovery.*` | H-25/26, M-49…M-53, L |
| Client core composables | `useProject`, `useLiveplayServer`, `useAudioEngine`, `useOutputTarget` | H-12/17/18/19, M-02/12/26, L |
| Client input composables | MIDI, hotkeys, carts, meters, i18n, state-viewer, `utils/audio` | M-13/28, L |
| Vue components (XSS/a11y) | app + 9 modals/panels (+ tree-wide `v-html` grep) | H-13, M-11/43/44, L |
| Build & locale scripts | Node build/version + 5 Python + 2 `.mjs` locale scripts | M-10/25/41, L |
| CI/CD | 3 workflows, `SIGNING.md`, `installer.nsh` | H-23, M-35/36/39, L |
| Dependencies | all `package.json`, `.npmrc`, `vcpkg.json` | H-04(cross), M-07/32/33/34/38, L |
| Deploy / containers | Dockerfiles, Caddy/nginx/Traefik, compose | C-03, M-37, L |
| Docs / hygiene / licensing | READMEs, `docs/*`, `LICENCE.txt`, crash file, fonts | M-29/30/31/34/45/46/47/48, L |
| Tests (cross-cutting) | whole-repo test search | H-24, M-39/40/41 |

> **XSS posture is actually good** (verified): the only `v-html` in the component tree is in `UpdateModal`, correctly sanitised with DOMPurify under a strict allow-list; all other untrusted strings render through Vue text interpolation. The risk there is the *absence of a lint rule banning `v-html`* to prevent a future regression, not a current hole.

## Appendix B — Rejected as false positives (verification rigor)

The adversarial pass rejected 3 plausible-looking findings after re-reading the code:
1. **"`stoi` numeric parsing can overflow/throw on hostile query/path input"** — the asserted unbounded allocation does not occur: `waveform.cpp:19` clamps `bucket_count` to 16…16384 and `project_state.cpp:1461-1466` clamps offset/limit *before* allocation. The guard lives downstream of the call site.
2. **"Meter playhead Map mutation doesn't trigger Vue reactivity"** — false: Vue 3 deep-reactive collections (`useState` uses `ref`, not `shallowRef`) make Map values reactive proxies, so in-place mutation *is* tracked.
3. **"vcpkg builds from the runner's floating baseline with no pinning"** — partially superseded; `vcpkg.json` does carry a `builtin-baseline`, so the accurate, narrower finding (no per-package overrides for security-sensitive parsers) is recorded under Dependencies instead.

The discovery-area review likewise explicitly confirmed the `recvfrom` UDP parse path is **bounds-safe** (no buffer overrun) to avoid a tempting false positive.

---

## Suggested Phase 2 prioritization (for your go-ahead)

Nothing below has been changed yet. Recommended sequencing — I'd want your sign-off on scope before touching code, especially the auth model (behaviour change) and any history rewrite.

**Wave 0 — Quick wins / safe, mostly non-behavioural (≈1 day)**
- C-03 fix Dockerfile `COPY` (+ a build smoke job).
- C-02 repoint updater feed/publish/homepage/author to the fork (or disable auto-update until correct).
- M-31 `git rm "liveplay crash.txt"` + add crash-dump globs to `.gitignore`.
- M-48 / docs: Nuxt 3→4, 20→21 locales; L: rename `LICENCE.txt`→`LICENSE`.
- M-38 commit `pnpm-lock.yaml`; switch CI to `--frozen-lockfile`.
- M-47 move the internal exploit work-order out of public `docs/`.

**Wave 1 — Close the network exposure (the headline risk)**
- **C-01**: default-bind `127.0.0.1` + pass `--bind 127.0.0.1` from Electron (small, closes the LAN hole for the default desktop case) — then design the opt-in auth/pairing model for LAN/tunnel use (H-05/06/07/08/13, M-08).
- H-09 authorize the `project/load` path / restrict to loopback; H-25 rate-limit + on-link-filter discovery.
- Add `app.max_payload` + body/zip caps (H-11), zip-slip containment check (H-10).

**Wave 2 — Crash-safety & data integrity (live-show reliability)**
- H-15 recursion/cycle guard; H-14 `find_cue` returns `shared_ptr`; H-26 async-signal-safe crash handler; H-16 LTC continuity.
- M-17 atomic `save()`; M-16 validate on `replace_full_document`; H-17/H-18/H-19 client sync error-handling, latch race, subscriber leaks.

**Wave 3 — Establish the safety net (so the above stays fixed)**
- H-23/H-24: stand up Vitest + CTest + ASan/UBSan/TSan + a happy-path integration test, lint/type-check gate; start by extracting pure logic from the god-modules (H-22, M-40).

**Wave 4 — Quality/maintainability (opportunistic)**
- God-module extraction (H-22, M-26/27), dependency currency (M-32/33, http-proxy/express/fluent-ffmpeg), container hardening (L), accessibility (M-43/44), locale-script consolidation (M-25), ADRs (M-45).

**My recommendation:** approve **Wave 0** immediately (low risk, high signal), then **Wave 1** as the priority — and tell me which auth model you prefer for LAN/tunnel (loopback-only by default vs. token vs. PIN-pairing). I will work on `chore/code-review-improvements`, one atomic commit per topic, running tests/linters as I add them, and I will check back before any larger refactor or anything touching git history.
