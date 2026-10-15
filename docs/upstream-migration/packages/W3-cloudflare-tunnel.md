# W3 — Remote sharing through a Cloudflare tunnel (quick or named)

| | |
|---|---|
| Upstream PR title | `feat(electron): share over the internet through a Cloudflare tunnel (quick tunnel or a fixed named tunnel)` |
| Branch (in the fork) | `up/W3-cloudflare-tunnel`, stacked on `up/W2-lan-web-sharing` |
| Depends on | **W2** (and therefore W1) |
| Size | ~500 lines: tunnel half of `web-share.js`, tunnel section of `WebShareModal.vue`, named-tunnel IPC in `main.js`, packaging |
| Fork sources | tunnel parts of `fcfcb17`, `35223eb`, `f33f657`, `06b4e6b` (asar spawn), `bfd4868` (named tunnel), `b48f324`/`b546412` (gate), `d2aebda` |
| Risk | **Highest acceptance risk of all packages**, because it exposes the rig to the internet. Ask the maintainer before investing (see master plan §4). If refused, keep W3 fork-only. It is self-contained. |

## Behaviour (kept from the fork)

- **Quick tunnel:** spawns the bundled `cloudflared` and gets a random
  `https://<words>.trycloudflare.com` URL. No account needed. The PIN gate is
  forced on.
- **Named tunnel:** the operator stores a tunnel token or credentials file and
  hostname once per machine (`userData`). The app always publishes on that
  fixed URL. This is what the club runs behind Cloudflare Access.
- The tunnel URL plus QR appear in the modal; the PIN is shown separately (W2 rule).

## Steps

1. `npm install --workspace client cloudflared@^0.7.1`. In `client/package.json`
   `build.asarUnpack`, add `"node_modules/cloudflared/**/*"` next to the
   ffmpeg/ffprobe entries. The binary must run from `app.asar.unpacked` (fork
   `06b4e6b` explains why).
2. Re-add the tunnel half of the fork's `web-share.js`: `startTunnel`,
   `stopTunnel`, `_resolveCloudflared()` (fork ~L550-600), quick-tunnel URL
   parsing (`TUNNEL_URL_RE`), named-tunnel config file handling, and the
   readiness detection. Add the active tunnel hostname to W2's Host allow-list.
3. Gate rules for tunnels:
   - A quick tunnel cannot start with the gate off. Refuse it in `startTunnel`
     and in the UI.
   - A named tunnel may run with the gate off only if the operator confirms that
     the hostname is protected upstream (Cloudflare Access). Store that
     confirmation with the named-tunnel config.
4. `main.js`: IPC `web-share:start-tunnel`, `stop-tunnel`, `get-tunnel-config`,
   `set-tunnel-config` (fork ~L815-910), plus `LIVEPLAY_TUNNEL_FILENAME = 'liveplay-tunnel.json'`
   and `readTunnelConfig()` / persistence (fork ~L180-240). The fork also accepts
   an env/CLI override there (see the numbered list in its comment). Keep the
   file name, so the club's named-tunnel setup survives the migration. Preload:
   add the four methods back.
5. `WebShareModal.vue`: re-add the tunnel section and the named-tunnel form.
6. Locales: the tunnel-only `webShare.*` keys (en and de from the fork, then
   `sync-locale-keys.js`).
7. Docs: an English version of `docs/web-sharing-stable-url.md`, the named
   tunnel setup. Mention that cloudflared is downloaded at `npm install` for the
   build host's platform/arch. Universal macOS builds therefore need a
   per-arch binary, which is a known limitation for the maintainer's release
   matrix.

## Verification

- Quick tunnel from a packaged macOS build: URL appears, phone on mobile data
  reaches it, PIN required, cue plays.
- Named tunnel with the club's real config, behind Cloudflare Access: fixed URL
  works.
- Stop the tunnel → URL dead within seconds. Quit the app → no `cloudflared`
  process left (`ps aux | grep cloudflared`).

## Done when

- [ ] Packaged macOS (arm64 + x64) and Windows builds start the tunnel.
- [ ] A quick tunnel refuses to run without the gate.
