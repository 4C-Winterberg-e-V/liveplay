# W1 — The renderer works in a plain browser

| | |
|---|---|
| Upstream PR title | `feat(client): run the renderer in a plain browser (same-origin server, bundled locales, Electron-only controls hidden)` |
| Branch (in the fork) | `up/W1-browser-renderer` |
| Base | upstream target branch |
| Depends on | nothing. Prerequisite for W2, W3, M1, M2. |
| Size | ~150-250 lines across ~10 client files. No server change. |
| Fork sources | `2c9747e`, `de95613`, `ad2c8cd` (+ the browser-relevant bits of `9e81c7f`, see below) |
| Risk | Low for Electron users: every change is behind "no `window.electronAPI`". |

## Why

Upstream's remote operation is "a desktop controller connects to a local or
remote audio server" (README). The renderer only works inside Electron. This
PR lets any browser that can reach the server, such as a phone on the venue
Wi-Fi, use the same UI. It is the foundation for in-app sharing (W2/W3) and
the phone layout (M1/M2).

Checked against upstream v2.5.1:

| Needed in a browser | Upstream v2.5.1 | Action |
|---|---|---|
| Default server URL = the page's own origin when served over http(s) from a non-loopback host | Always `http://127.0.0.1:4480` (`useLiveplayServer.ts` ~L60). A phone would dial itself | **Port** `computeDefaultServerUrl()` from the fork |
| Locales without Electron IPC | `loadLocales()` returns early without `electronAPI` (`useLocalization.ts` L10), so a browser shows **raw keys** | **Port** the `import.meta.glob` bundle fallback (`de95613`) |
| Don't open a WebSocket blindly in the plugin; let WelcomeScreen probe `/api/health` first | Plugin calls `server.connect()` in the browser branch | **Port** `ad2c8cd` (plugin) |
| WelcomeScreen in a browser: skip Local/Remote mode picker, connect to same origin | Shows the mode picker; "Local" cannot work in a browser | **Port** `2c9747e` + `ad2c8cd` (WelcomeScreen parts) |
| Hide Electron-only controls | Pane pop-out already hidden (`useWorkspaceLayout.canDetach` checks Electron) | **Port** the remaining `hasElectron` guards (list below) |
| CORS preflight for cross-origin hosting | Fixed upstream (#62 in `transport-fixes-e2e.js` A: middleware answers OPTIONS) | **Do not port** `9e81c7f`. Same-origin sharing does not need it either |
| `BUILD_TARGET=web` / `generate:web` (separately hosted SPA) | n/a | **Do not port.** Web sharing serves the normal Electron build (`.output/public`, relative base). The fork removed its hosting kits (`df02972`) |

Also fix, because it surfaced during this analysis and affects phones (the fork
has the same bug): `/api/whoami` decides `isLocal` from the remote IP. Behind
the web-share proxy (W2) every phone request comes from `127.0.0.1`, so a phone
is treated as "local" and the import dialog hides the **upload** option. A
browser has no native dialogs, so for a browser client "local" is never true.

## Steps

All edits are in `client/app/`. Upstream changed most of these files since
v2.4.3: **re-apply the fork's intent by hand, never paste whole fork files.**

1. `composables/useLiveplayServer.ts`
   - Add `computeDefaultServerUrl()` from the fork (`git show origin/main:client/app/composables/useLiveplayServer.ts`,
     ~L67-91) above `createClient()`. Use it for the initial value:
     `const defaultUrl = computeDefaultServerUrl();`. Keep upstream's
     `localStorage 'liveplay.serverUrl'` precedence: it is step 1 inside the
     function.
   - Keep upstream's `wsUrl` (it appends `?access_token=` when signed in). Do
     **not** take the fork's simpler `wsUrl`.
   - In `refreshIsLocalServer()`, first line:
     `if (typeof window !== 'undefined' && !(window as any).electronAPI) { isLocalServer.value = false; return; }`
     with a comment: "a browser has no native file dialogs; the server's
     loopback test is wrong behind a same-origin proxy".
   - Optional, from `de95613`: route the noisy `[liveplay]` request/send logs
     through a `dlog` guarded by `localStorage 'liveplay.debug' === '1' || import.meta.dev`.
     Skip it if upstream has already reduced logging.
2. `composables/useLocalization.ts`: port the `localeBundle = import.meta.glob('../../locales/*.json', { eager: true, import: 'default' })`
   fallback and the two-branch `loadLocales()` from fork `de95613` (see its diff).
   Keep upstream's error handling (`_loadLocalesPromise = null` retry) and its
   `t()` English fallback. The Electron branch stays exactly as upstream has it.
3. `plugins/liveplay-server.client.ts`: remove the `else { server.connect(); }`
   browser branch and add the fork's comment (`ad2c8cd`). WelcomeScreen now owns
   the browser connection flow.
4. `components/WelcomeScreen.vue` (upstream rewrote parts; adapt):
   - `const hasElectron = import.meta.client && !!(window as any).electronAPI;`
   - Hide the "servers on this network" discovery block with `v-if="hasElectron"`
     (UDP discovery is Electron-only).
   - In `onMounted`, before upstream's default "show the mode picker" branch, add
     the fork's pure-web branch from `2c9747e`/`ad2c8cd`. Set mode `remote`. If
     `server.serverUrl` equals `window.location.origin`, probe `/api/health`,
     then `setServerUrl(origin)`, then `tryRejoinExistingProject()`, else go to
     the project stage. On failure, prefill the address field. If upstream
     renamed `probeServerReachable`/`stripScheme`, use the upstream names.
   - If upstream shows `LoginScreen` when the server requires auth, make sure
     the web branch still reaches it: connect first, then let upstream's auth
     check run.
5. `hasElectron` guards. Each one hides a control that cannot work in a
   browser:
   - `components/ConnectionLostModal.vue`: Restart and Exit buttons and their
     hint lines (fork `de95613`).
   - `components/PlaylistView.vue`: the "Import from YouTube" button (yt-dlp is
     Electron-only).
   - `components/SettingsPaneAbout.vue`: the version badge (upstream moved
     AboutModal here; `getAppVersion` is Electron-only). Hide or show "web".
   - `components/SettingsPaneAudio.vue`: the YouTube import settings block.
     Its handlers already no-op; hide the section.
   - Anything else found by the browser smoke test below.
6. i18n: no new strings expected. If one is needed, follow the master plan's
   i18n rule.

## Verification

```sh
npm run build:client                         # Electron build still fine
npm run dev:client                           # Nuxt dev on :3000
npm run server:run -- --port 4480            # second terminal
```

- Open `http://<LAN-IP>:3000/?` from another device, or a desktop browser with
  the address field set to `http://<LAN-IP>:4480`. Open DevTools and click
  through Welcome → open project → playlist, carts, mixer, Settings (every pane)
  → transport → disconnect/reconnect. **The console must show no
  `electronAPI` TypeErrors** and no raw locale keys. Fix each one with a guard.
- Electron (`npm run dev`): the welcome flow, mode picker, discovery, YouTube
  button and About version are unchanged.
- With W2 later: a phone via the share URL connects automatically
  (same-origin), and the import dialog offers **Upload**.

## Done when

- [ ] Browser smoke test clean. Electron behaviour unchanged.
- [ ] No `BUILD_TARGET`, no `generate:web`, no deploy files in the diff.
