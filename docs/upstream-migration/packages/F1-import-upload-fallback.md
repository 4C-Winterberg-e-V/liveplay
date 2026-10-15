# F1 — Import a picked file even when the server's allow-list refuses its path

| | |
|---|---|
| Upstream PR title | `fix(client): upload a picked file when the server's filesystem allow-list refuses its path` |
| Branch (in the fork) | `up/F1-import-upload-fallback` |
| Base | upstream target branch |
| Depends on | nothing |
| Size | ~40 lines (`useLiveplayServer.ts` + two call sites) |
| Fork source | `66899a3` (client half only: `importPathToMedia`, PlaylistView/CartSlot call sites) |
| Risk | Low. The fallback only runs when `copyToMedia` already failed. |

## What this replaces from the fork

The fork's **server filesystem sandbox** (`fs_sandbox.hpp/.cpp`, the
`control_server.cpp` guards and `test_fs_sandbox.cpp` from `66899a3` and
`3fa1991`) is **superseded and must NOT be ported**. Upstream `1e60942` added
its own allow-list:

| Fork sandbox | Upstream allow-list (v2.5.1) |
|---|---|
| On by default: Music, Documents, Desktop, Downloads, Documents/LivePlay, plus the open project's folder | **Off by default** (permissive, as before 2.5). Enabled by listing roots |
| `LIVEPLAY_FS_ROOTS` env var adds roots | `LIVEPLAY_FS_ROOTS`, `--fs-root` (repeatable), or `"fsRoots": [...]` in `liveplay.json` |
| Out-of-root → 403 | Out-of-root → 403 (`json_fs_denied`), checked before any side effect |
| `GET /api/fs/list` with empty path → the roots | Same: with roots configured, the "computer root" listing is the roots |
| Opening a project by absolute path adopts its folder as a root | **Not supported.** Load/save outside the roots is refused, so roots must cover where shows live |

**Fork posture after migrating:** on the show laptop, set the roots either in
*Settings → Server* (`fsRoots` is one of the two "policy" settings there; it
applies after a server restart) or in `liveplay.json`. Upstream reads that file
from `--config <path>`, then `LIVEPLAY_CONFIG`, then `liveplay.json` beside the
server executable. Upstream does **not** expand `~`, so use absolute paths:

```json
{ "schema_version": 1,
  "fsRoots": ["/Users/<you>/Documents/LivePlay", "/Users/<you>/Music", "/Volumes/ShowDrive"] }
```

When the server is reachable through the web-share tunnel, set this. It is the
defense-in-depth layer the fork's sandbox provided by default.

The **one behaviour gap** that needs code is this PR. When roots are configured,
picking a file in the native Electron dialog from a folder outside the roots
calls `copyToMedia(path)`, which upstream refuses with 403, and the import
fails. Drag-and-drop already falls back to uploading bytes
(`resolveDroppedFileToMedia`, `useLiveplayServer.ts` ~L1693). The dialog path
does not.

## Steps

1. In upstream `client/app/composables/useLiveplayServer.ts`, after
   `resolveDroppedFileToMedia`, add `importPathToMedia(srcPath)`. Copy it from the
   fork: `git show origin/main:client/app/composables/useLiveplayServer.ts`,
   search `async function importPathToMedia`, ~25 lines. Adapt names to
   upstream: check that `copyToMedia`, `uploadFile`, `dwarn`, `derr` exist with
   the same signatures (`grep -n "function uploadFile\|const dwarn\|function dwarn"`).
   If `uploadFile` returns a different shape upstream, read the path the same
   way `resolveDroppedFileToMedia` does.
2. Export it from the composable's returned object, next to `resolveDroppedFileToMedia`.
3. In `client/app/components/PlaylistView.vue` (~L323) and `CartSlot.vue`
   (~L401), replace `destPath = await server.copyToMedia(serverPath);` with
   `destPath = await server.importPathToMedia(serverPath);`. Keep upstream's
   surrounding error handling. If the result is `null`, skip the file the same
   way upstream handles a thrown `copyToMedia` (see the surrounding `try`). The
   fork version is at `PlaylistView.vue` ~L360 and `CartSlot.vue` ~L381 in
   `origin/main` for reference.
4. The Electron bridge `readAudioFile` already exists upstream
   (`client/electron/preload.js` L25). Nothing to add there.

## Tests

Extend the existing e2e `server/tests/e2e/fs-jail-e2e.js` only if it already
covers `/api/upload`. Otherwise this is a client-only manual test:

1. Start the server with `--fs-root <tmpdir>`.
2. In the app, import a WAV from a folder outside `<tmpdir>` via the playlist's
   "add audio" dialog and via a cart slot. Both imports succeed, and the file
   lands in the project's media folder.
3. Without `--fs-root`, behaviour is unchanged: the fast server-side copy, no
   upload.

## Done when

- [ ] Both dialog import paths work with roots configured. No change without roots.
- [ ] `npm run build:client` green.
