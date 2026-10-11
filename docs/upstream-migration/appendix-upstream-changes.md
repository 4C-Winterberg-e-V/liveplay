# Appendix A — What upstream changed since the fork last synced

Range: `3c3d27c` (upstream **v2.4.3**, 2026-07-29 — the last upstream commit the fork
merged, via `d2053b1`) → `6295947` (upstream `main` = **v2.5.1**, 2026-10-06).

229 commits, 271 files, +77.8k / −14.3k lines. Authors: DI Aspinwall (127),
Thomas Doukinitsas (87), horikei525 (2). All upstream side branches
(`2.5.0-dev`, `2.5.1-dev`, `custom-indexing`, …) are already merged into `main`.

How upstream works: outside contributors open PRs; the maintainer collects
them on a release branch named `X.Y.Z-dev` (e.g. PR #72 → `2.5.1-dev`) and
merges that into `main` for a release. Upstream has no CONTRIBUTING file and
no PR template. Commit messages are conventional (`feat:`, `fix:`, `docs:`,
`i18n:`, `test:`) with long explanatory bodies, and features come with tests
(unit + e2e) and docs in the same PR.

## A.1 Audio: buses, mixer, DSP (the bulk of v2.5.0)

- Bus definitions live in the project document; items/groups inherit a bus
  assignment (`b0feac2`, `77a5847`, `61c0365`). Legacy per-item
  `deviceOverride` is migrated onto buses on load (`79d4717`).
- **Logical output map**: buses reach hardware through named logical outputs.
  Physical device/channel mapping lives on the server in `outputs.json`, not in
  the show file (`576e715`, `c98dae3`, `069898c`, `8acbd52`). The show file also
  no longer stores an absolute project folder (`bd1a1e3`).
- Mixer panel with channel strips, a detachable mixer window, and a knob
  control (`a682a15`, `30b8936`, `ffcbd9c`). Also PFL and a Monitor/Preview bus
  (`76deea4`).
- Channel DSP: HPF/LPF and parametric EQ, later a 32-band EQ with any filter
  type plus a spectrum analyser (`7ec32fe`, `585545f`). Also gate/expander,
  compressor/limiter, balance and M/S width, and a mono-sum audition.
- Bus→bus routing in topological order, with loops refused (`a10d877`,
  `632371d`). Also aux sends (`52947e2`) and bus roles, where Master and Preview
  are ordinary buses with a flag (`e8d39cb`).
- Clock-drift compensation (`13bb625`, `d6e0359`); output latency reduced from
  427 ms to 37 ms (`625e400`).
- Performance work: no render-thread allocation, and no topology or limiter
  rebuild on every save (`8b37fa3`, `16816de`, `3c0d923`, `c166e2e`).
- LTC goes to a logical output instead of naming a sound card (`583ef2c`).

## A.2 Settings, configuration, ownership

- **Settings registry** for project settings: unknown keys are dropped and
  values are type/range-checked (`fd3ca36`).
- **Settings page** with a persistent rail, deep-linkable as
  `#/settings/<section>` (`fa12985`). It replaces several dialogs, which
  upstream **deleted**:
  - `ProjectSettingsModal.vue` → `SettingsPaneProject/Playback/Audio/Mixer/Outputs.vue`
  - `ControlConfigModal.vue` and `CartHotkeyConfig.vue` → `SettingsPaneKeyboard.vue` and `SettingsPaneSurfaces.vue` (`78b8f79`)
  - `AboutModal.vue` → `SettingsPaneAbout.vue`; there is also a new `SettingsPaneAppearance.vue` (`19b3616`)
  - `ServerSettingsModal.vue` → `SettingsPaneServer.vue` (`a1fd5fc`)
- Hotkey and MIDI lifetime moved from `CartPlayer` to `MainWorkspace` (`78b8f79`).
- `liveplay.json` boot config with precedence defaults → file → env → CLI
  (`488e790`, `server_config.cpp`).
- **Filesystem allow-list** (`--fs-root`, `LIVEPLAY_FS_ROOTS`) and a
  **configurable CORS origin**. Both are opt-in; the default stays permissive
  (`1e60942`).
- Per-user preferences on the server (`prefs/<id>.json`): theme, meter display,
  keyboard bindings, locale (`584d13f`, `1bdd515`, `usePreferences.ts`).
- Ownership model documented in `docs/OWNERSHIP_MODEL.md`: what belongs to
  the project, the server, the user, the machine, and the session.

## A.3 Users, sessions, authentication (opt-in)

- Each WebSocket connection gets a `ClientSession`. The socket enforces the
  CORS origin policy (`94c7ae1`).
- Optional accounts in `users.json`, Argon2id passwords, and signed stateless
  tokens: REST uses a `Bearer` header, the WebSocket a query-string token. There
  is a login screen, plus admin and operator roles (`2cb72ee`). A server can
  stop requiring a login (`031e2e9`).
- Users pane: accounts, API tokens, who is connected, profile pictures, and
  export/import (`78811ee`, `3c564ec`, `230b803`, `48d930c`, `2a284e9`,
  `d794473`).

## A.4 Workspace / UI model

- **One workspace model** for Playlist, Cart Player and Mixer (`e00115e`). A
  workspace bar of pane toggles sits in the header, and `PaneControls` on each
  pane offers expand/restore/close and pop-out. Splitters snap, and panes
  collapse to an edge bar (`0543af1`).
- The layout persists in `localStorage['liveplay-workspace-layout']`
  (`cbd1854`). Electron windows reopen where they were left (`ca1c75d`). The
  properties panel is a resizable pane (`db5457b`).
- Multi-item editing: edit any property on several items at once (`5856dd5`,
  `utils/multiEdit.ts`).
- Electron window floor of 1280×768 (`ca8d116`, `609df4c`). Upstream did **no**
  phone/touch layout work.

## A.5 Playback features

- Fades as long as the audio, a per-cue Stop fade, and a fader you can type
  into (`79183a5`). Loops can crossfade into themselves (`52c7b6f`), and a cue
  can wait before the next one starts (`d9e92c5`).
- Groups know their duration and can sit in a cart slot (`2751430`). A closed
  group shows what is playing inside it (`cf83655`).
- API/transport fixes (`ecb110a`, `610ca59` — a HEAD request no longer fires a
  cue). Playlist rows no longer vanish (`1df20e9`), and the "earlier version"
  banner no longer reappears (`7720316`).

## A.6 Server operations (v2.5.1)

- `--silent` runs the server from a system-tray icon on Windows, macOS and
  Linux, and the client launches a local server silently into the tray
  (`4d830b2`, `08d5b8f`, `cf61dff`).
- Linux: works offline and on older distros (`a645754`, #71). Every server DLL
  is bundled on Windows (`4711abe`).
- YouTube import: choose the output format (WAV etc.) and use a standalone
  yt-dlp on macOS/Linux (`9737481`, `d42d6ea`, `54f797d`).

## A.7 i18n, docs, tests

- Every on-screen string goes through the locale files, which were rebuilt in
  all 21 languages. English grew from 458 to 974 strings (`557e423`,
  `62604e4`, `0a72373`, `2ff4a34`).
- `docs/` holds `API_AUDIT.md`, `BUS_ARCHITECTURE.md`, `DEVELOPMENT.md`,
  `OWNERSHIP_MODEL.md` and `README.md`. The READMEs were slimmed and
  `IMPROVEMENTS_PLAN.md` deleted.
- docs-site was rewritten. It now carries an **API reference**
  (`docs-site/public/api/reference.json`) checked by
  `docs-site/scripts/check-api-reference.mjs`.
- Tests:
  - About 35 end-to-end suites in `server/tests/e2e/*.js`, run with Node against
    a running server.
  - 9 framework-free C++ unit binaries, registered under
    `-DLIVEPLAY_BUILD_TESTS=ON` and run by CTest.
  - Client checks as plain Node scripts in `client/tests/*.js`.
- CI: `build-server.yml` runs on pull requests. `build-release.yml` runs when
  the root `package.json` version changes on `main`, so a PR must never bump
  versions. npm workspaces with `package-lock.json`.

## A.8 Consequences for the fork

1. Every fork change to `ProjectSettingsModal.vue`, `ControlConfigModal.vue`
   and `AboutModal.vue` (X18 config, output-channel config, browser
   degradation, mobile tweaks) has to be **re-homed** into the matching
   `SettingsPane*.vue`.
2. Anything the fork persists in project `settings` must be **registered** in
   the settings registry, or upstream silently drops it.
3. Anything the fork adds to the HTTP/WS API must be added to the **API
   reference catalog**.
4. `MainWorkspace.vue` / `ProjectHeader.vue` were rebuilt around the
   workspace model. The fork's mobile layout and the X18 tab must be rebuilt on
   top of it, not merged line by line.
5. Upstream now has an opt-in filesystem allow-list, CORS origin, WebSocket
   origin check and accounts. These overlap with the fork's sandbox and
   web-share gate (see the package decisions in the master plan).
