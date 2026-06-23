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
        { name: 'viewport', content: 'width=device-width, initial-scale=1' }
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