# W2 — Share the UI to phones on the LAN, behind a PIN

| | |
|---|---|
| Upstream PR title | `feat(electron): share the UI to phones and tablets on the local network (same-origin proxy, PIN, QR code)` |
| Branch (in the fork) | `up/W2-lan-web-sharing`, **stacked on** `up/W1-browser-renderer` until W1 is merged |
| Base | upstream target branch + W1 |
| Depends on | **W1** |
| Size | ~1,100 lines: `web-share.js` (LAN part) ~400, `WebShareModal.vue` (LAN part) ~350, `main.js` ~120, `preload.js` ~20, locales |
| Fork sources | `fcfcb17`, `35223eb`, `9c2c8c0`, `f33f657`, `7b488c7`, `72dd5fb` (PIN), `782dafc`, `06b4e6b`, `b48f324`, `b546412`, `9ed75c9`, `d2aebda`, `86cd508`/`a0fc906` (dev allowedHosts) |
| Risk | Medium: it opens a listening port. That is why the hardening below is **part of this PR**, not a follow-up. |

## Behaviour (kept from the fork)

- Settings/menu entry "Share to phones…" opens `WebShareModal`.
- **Local network:** an in-process Express server on `0.0.0.0:8088` serves the
  renderer build (`.output/public`). It proxies `/api/*` and `/ws` to the local
  C++ server, so the phone uses one origin and needs no CORS or address entry
  (W1 picks `location.origin`). The modal shows the LAN URL(s) and a QR code.
- **PIN gate:** a 4-6 digit PIN, random per app session or operator-chosen
  (persisted). A login page sets an `lp_auth` session cookie so the WebSocket
  survives. The gate can be switched off for a trusted LAN.
- Dev mode proxies the UI to the Nuxt dev server (`http://localhost:3000`).

## Interplay with upstream features (verified)

- **Upstream accounts (opt-in, `users.json`):** tokens ride in the
  `Authorization` header and `?access_token=` on the socket. The proxy forwards
  both unchanged, so a phone shows upstream's LoginScreen when auth is on. The
  PIN gate is an extra, quick layer for the default no-accounts setup. Say this
  in the PR, and offer to drop the PIN gate if the maintainer prefers to
  require accounts for sharing.
- **WebSocket origin policy:** with the default `corsOrigin` `*`, everything is
  admitted. If an operator pins `corsOrigin`, the phone's origin
  (`http://<lan-ip>:8088`) is refused unless it matches. Document this. An
  optional improvement, not required: the proxy sets `Origin` to the server's
  own origin on requests that passed the gate.
- **Connected-clients list** (`/api/clients`): proxied phones appear as
  `127.0.0.1`. Optional: send `X-Forwarded-For`. Upstream does not read it, so
  leave it as a documented limitation.

## Hardening the fork never did, required for upstream

The fork's own review lists these (`CODE_REVIEW.md` H-05, H-06, H-07, M-01,
M-09). Upstream has no Cloudflare Access perimeter in front of it, so close
them:

1. **Host/Origin allow-list** on HTTP and the WS upgrade (H-05, DNS
   rebinding). Accept only `localhost`, `127.0.0.1`, the machine's LAN IPs at
   the share port, and (W3) the active tunnel hostname. Answer anything else
   with 403. About 20 lines in `web-share.js` (`_hostAllowed(req)`).
2. **PIN brute-force protection** (H-06): count failures per IP. After 5, block
   that IP for 60 s, then double the block on each further failure. Include a
   short fixed delay on every failure. In-memory only.
3. **Credentials not in the QR or URL** (M-09): the QR encodes the plain URL.
   The PIN is shown next to it and typed on the phone's login page. Remove
   `tunnelLinkWithAuth()` / `user:pass@host` URLs.
4. **Turning the gate off** (H-07, M-01): allowed for LAN only, behind a
   confirmation. Mask the PIN in the modal behind a "show" toggle.

## Steps

1. `npm install --workspace client http-proxy-3@^1.23.3 qrcode@^1.5.4`. Keep the
   `package-lock.json` change limited to these packages.
2. `git show origin/main:client/electron/web-share.js > client/electron/web-share.js`,
   then:
   - **Remove** the tunnel code, which belongs to W3: `startTunnel`/`stopTunnel`,
     cloudflared resolution and spawn, the named-tunnel config, `TUNNEL_URL_RE`,
     `tunnelLinkWithAuth`. Leave a small extension point, e.g. `extraAllowedHosts`.
   - Add the hardening items 1-3.
   - Translate the remaining German string (L408) and any German comments to English.
3. `client/electron/main.js` (upstream changed it heavily; insert, don't merge):
   - `const { WebShare, DEFAULT_WEB_PORT } = require('./web-share');` near the
     other requires.
   - `LIVEPLAY_WEBSHARE_FILENAME = 'liveplay-webshare.json'`,
     `webSharePrefsPath()`, `readWebSharePrefs()` and `updateWebSharePrefs()`.
     They store `{ authEnabled, pin }` in `userData`. Take them from the fork
     (~L241-270 in `origin/main`). Keep the same file name, so existing fork
     installs keep their custom PIN. Do **not** take the `liveplay-tunnel.json`
     code; that is W3.
   - `getWebShare()` plus the IPC handlers `web-share:get-status`, `start-lan`,
     `stop-lan`, `set-auth-enabled`, `set-pin`, and the `web-share:state` push
     (~L768-850 in `origin/main`). Pass `serverPort` from upstream's current
     local-server port variable (`LIVEPLAY_DEFAULT_PORT` / the running port).
   - Stop the LAN share in the app's quit handler (fork ~L3573).
4. `client/electron/preload.js`: add the `webShare` bridge (fork L209-223)
   **without** the tunnel methods.
5. `client/app/components/WebShareModal.vue`: copy from the fork and remove the
   tunnel section. It is a modal (`<Teleport>`/overlay). Keep it a modal.
6. Entry point, minimal and upstream-idiomatic:
   - an item in the Electron app menu (File or View: "Share to phones…") that
     sends an IPC event the renderer turns into `showWebShare = true` (copy how
     upstream wires other menu events, e.g. `onMenuOpenProject`);
   - a "Sharing" block with an "Open sharing…" button in
     `SettingsPaneServer.vue`, Electron only;
   - a header action button only if the maintainer wants one. The fork had
     one; upstream's header compacts in measured steps (`e00115e`), so adding a
     button there needs care.
7. `client/nuxt.config.ts` (dev only): `vite.server.allowedHosts` from the fork
   (`NUXT_DEV_ALLOWED_HOSTS`, default `true`). The dev server is only reachable
   through the share proxy. Comment it as dev-only.
8. Locales: add the `webShare.*` keys used by the trimmed modal to `en.json`
   (fork text) and `de.json` (fork text), then `node scripts/sync-locale-keys.js`.
   Drop keys that only the tunnel UI uses.
9. Docs: a short "Share to phones" subsection under README "Remote operation"
   (port 8088, PIN, trusted network). Add an English `docs/WEB_SHARING.md` only if
   the README section would exceed ~15 lines. The German fork docs stay in the fork.

## Verification

- Electron dev: open the share modal, start LAN sharing, scan the QR with a
  phone on the same Wi-Fi. Enter the PIN; the UI loads, connects and plays a cue.
- Five wrong PINs → blocked for 60 s (check with curl from another machine).
- `curl -H 'Host: evil.example' http://<lan-ip>:8088/` → 403.
- Reload the phone page → still logged in (cookie). Restart the app → new random
  PIN, unless a custom PIN is set.
- Upstream auth on (create an account): the phone shows LoginScreen after the PIN.
- `npm run build:client:electron` packages `http-proxy-3` and `qrcode`. Start
  the packaged app and share again.

## Done when

- [ ] LAN share works on macOS and Windows packaged builds.
- [ ] Hardening items 1-4 in place. No tunnel code in this PR.
