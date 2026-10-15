# M3 — Installable web app (PWA) for the shared UI

| | |
|---|---|
| Upstream PR title | `feat(client): installable web app manifest and a pass-through service worker` |
| Branch (in the fork) | `up/M3-pwa` |
| Depends on | **W1**. It is only useful when the UI is reached over HTTPS (W3 tunnel) or localhost. On iOS, "Add to Home Screen" also works over http thanks to the meta tags. |
| Size | ~200 lines + 3 PNG icons |
| Fork sources | `4f0be02`, the PWA-related meta/link tags from `ad2c8cd` / `f91917d` |
| Risk | Low. The worker caches nothing and registers only in secure, non-Electron contexts. |

## Steps

1. Copy verbatim from the fork:
   - `client/public/manifest.webmanifest`
   - `client/public/sw.js` (pass-through; read its header comment)
   - `client/app/plugins/pwa.client.ts`
   - `client/public/assets/icons/pwa/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`
   - **Not** `client/scripts/gen-pwa-icons.mjs`. It imports `playwright`, which
     is not an upstream dependency. Commit the three generated PNGs and say in
     the PR how they were made.
2. `client/nuxt.config.ts` `app.head`: add the fork's `meta` entries
   (`mobile-web-app-capable`, `apple-mobile-web-app-capable`,
   `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`,
   `theme-color` `#161616`, which must match upstream's actual background
   colour) and `link` entries (`icon`, `apple-touch-icon`, `manifest` with
   `crossorigin: 'use-credentials'`). Keep the fork's comments, especially the
   one explaining `use-credentials` with the W2 PIN gate. If W2 is not merged,
   still keep it: it is harmless without the gate.
3. Upstream's dark theme background is `#161616` (`main.scss` L107) and the
   light theme's is `#ebebeb` (L91). Keep `#161616` for the manifest. For the
   meta tag, use two tags with `media="(prefers-color-scheme: light|dark)"`, so
   the browser chrome matches a light-theme phone.

## Verification

- Electron: no service worker registered (DevTools → Application), no change.
- Through the W3 tunnel (https) on Android Chrome: "Install app" is offered;
  the installed app opens fullscreen and connects. The DevTools Network tab
  shows API calls are **not** served from the service worker.
- Over the LAN share (http): no registration attempt, no console error.
