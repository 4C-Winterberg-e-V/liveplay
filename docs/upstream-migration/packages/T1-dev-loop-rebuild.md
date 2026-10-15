# T1 — `npm run dev` rebuilds a stale server and stops the old one

| | |
|---|---|
| Upstream PR title | `fix(scripts): rebuild the server in npm run dev when its sources changed, and stop the stale one` |
| Branch (in the fork) | `up/T1-dev-loop-rebuild` |
| Base | upstream target branch |
| Depends on | nothing |
| Size | ~90 lines in `scripts/ensure-server.js` + 2 lines in `docs/DEVELOPMENT.md` |
| Fork sources | `1e03583` (rebuild on change), `751f351` (stop the stale detached server), `cade162` (run cmake from `server/`) |
| Risk | Low. Developer tooling only. |

## Why upstream wants this

- Upstream `docs/DEVELOPMENT.md` documents the gap itself: "`npm run dev` ...
  does not rebuild an existing server binary after C++ changes".
- `scripts/ensure-server.js` is **unchanged upstream since v2.4.3**, so all three
  fork fixes still apply:
  1. A binary older than any file in `server/src`, `server/include`,
     `CMakeLists.txt`, `CMakePresets.json` or `vcpkg.json` is rebuilt
     incrementally.
  2. After a rebuild, a still-running detached server on the dev port is
     stopped. Upstream Electron still spawns the server **detached** and
     reattaches through a lockfile (`client/electron/main.js` ~L40-90,
     ~L540-641), so without this the old binary keeps serving.
  3. `cmake --preset` resolves `CMakePresets.json` from the **current working
     directory**. Upstream runs it from the repo root with `-S server`, which
     fails on a clean checkout. The fork runs it with `cwd: SERVER_DIR`.

## Steps

1. Take the fork's final file:
   `git show origin/main:scripts/ensure-server.js > scripts/ensure-server.js`.
2. Replace the two comment/console strings that say `pnpm dev` with `npm run dev`.
   Run `grep -n pnpm scripts/ensure-server.js`; the result must be empty.
3. `stopStaleServer()` uses `LIVEPLAY_PORT || '4480'`. Confirm 4480 is still
   upstream's default: `LIVEPLAY_DEFAULT_PORT = 4480` in `client/electron/main.js`.
4. In `docs/DEVELOPMENT.md` ("Build and run"), replace the sentence "It does not
   rebuild an existing server binary after C++ changes; run `npm run server:build`
   for those changes." with: "It rebuilds the server when any server source,
   header or CMake/vcpkg manifest is newer than the binary, and stops a
   previously started dev server on port 4480 (`LIVEPLAY_PORT`) so the new build
   is used."
5. One commit. Use the fork's three commit messages as the body, in English.

## Verification

```sh
npm run dev            # first run: builds if missing
# edit a comment in server/src/main.cpp, Ctrl-C, then:
npm run dev            # prints "server sources changed since last build — rebuilding (incremental)"
                       # and "stopped stale server (pid …)" on macOS/Linux
npm run dev            # prints "server binary up to date"
```

On a fresh clone with no `server/build`, `npm run dev` must configure from
`server/` without the "could not read presets" error.

## Done when

- [ ] Script and DEVELOPMENT.md updated. No `pnpm` strings left.
- [ ] The three manual runs above behave as described on macOS or Linux. Windows prints the hint.
