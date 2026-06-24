// https://nuxt.com/docs/api/configuration/nuxt-config

// ---------------------------------------------------------------------
// Build-target weiche (web vs. Electron)
// ---------------------------------------------------------------------
// Both `generate` (Electron) and `generate:web` run with NODE_ENV=production,
// so NODE_ENV alone can't tell them apart. The web build sets BUILD_TARGET=web.
//
// Why read the env HERE rather than relying on Nuxt's native NUXT_APP_BASE_URL:
// an explicit `app.baseURL` in this config takes precedence over the env var,
// so setting NUXT_APP_BASE_URL externally would be silently ignored. Reading it
// in-config makes the resolution deterministic.
//
//   * Electron  → file:// loading needs fully relative paths ('./').
//   * Web       → served from an absolute base ('/' or a configurable subpath
//                 via NUXT_APP_BASE_URL, e.g. '/liveplay/'); assets resolve
//                 relative to that base, so cdnURL stays empty.
const isWeb   = process.env.BUILD_TARGET === 'web';
const isProd  = process.env.NODE_ENV === 'production';
const webBase = process.env.NUXT_APP_BASE_URL || '/';

const appBaseURL = isWeb ? webBase : (isProd ? './' : '/');
const appCdnURL  = isWeb ? ''      : (isProd ? './' : '');

export default defineNuxtConfig({
  devtools: {
    enabled: true,

    // Timeline disabled: it wraps every auto-imported composable in a
    // `__nuxtTimelineWrap` at module-top-level, which reads the wrapped
    // binding eagerly. With the useCartItems ↔ useProject auto-import
    // cycle that read hits TDZ and crashes the renderer to a white screen.
    // Re-enable only after breaking the cycle (e.g. move the shared map
    // out of useCartItems into a neutral module imported by both).
    timeline: {
      enabled: false
    }
  },
  ssr: false,
  
  app: {
    head: {
      title: 'LivePlay',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        // Mobile / add-to-home-screen polish (ignored by Electron).
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'LivePlay' },
        { name: 'theme-color', content: '#1a1a1a' }
      ],
      // Relative hrefs so they resolve under any base path (web '/', sub-path,
      // or Electron file://). Providing an explicit icon also stops the browser
      // from requesting /favicon.ico and logging a 404.
      link: [
        { rel: 'icon', type: 'image/png', href: 'assets/icons/1x/liveplay-icon-darkmode@1x.png' },
        { rel: 'apple-touch-icon', href: 'assets/icons/2x/liveplay-icon-darkmode@2x.png' }
      ]
    },
    // Electron: relative paths for file://. Web: absolute base (see weiche above).
    baseURL: appBaseURL,
    buildAssetsDir: '_nuxt/',
    cdnURL: appCdnURL
  },

  css: [
    // assets/ lives at the project root (shared with Electron), so use the
    // rootDir alias (~~) rather than the srcDir alias (~), which now points
    // at app/ under Nuxt 4.
    '~~/assets/styles/main.scss'
  ],

  vite: {
    // Dev server only: the in-app web-share proxy (electron/web-share.js)
    // forwards phone/tunnel requests to this Vite dev server. Vite blocks
    // unknown Host headers (DNS-rebinding guard) — LAN access via IP is fine,
    // but a Cloudflare quick-tunnel domain gets rejected ("This host is not
    // allowed"). Allow any *.trycloudflare.com subdomain (the hostname is
    // random per tunnel). No effect on production builds (no dev server).
    server: {
      allowedHosts: ['.trycloudflare.com']
    },
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: '@use "~~/assets/styles/variables.scss" as *;'
        }
      }
    }
  },

  modules: [],

  // Preserve the pre-Nuxt-4 non-strict TypeScript behaviour for this project.
  typescript: {
    strict: false
  },

  compatibilityDate: '2025-10-31'
})