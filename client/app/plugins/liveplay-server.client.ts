// =====================================================================
// plugins/liveplay-server.client.ts
// ---------------------------------------------------------------------
// Nuxt plugin (client-side only) that:
//   1. Reads the server-mode config from Electron's main process
//      (local vs remote, persisted in <userData>/liveplay-server.json).
//   2. Points useLiveplayServer at the correct URL.
//   3. Listens for state changes from the main process (e.g. the user
//      flipped to remote mode in the settings modal) and re-targets.
//   4. Kicks off the auto-reconnecting WebSocket.
// =====================================================================
import { defineNuxtPlugin } from 'nuxt/app';
import { useLiveplayServer } from '~/composables/useLiveplayServer';

export default defineNuxtPlugin(async () => {
  const server = useLiveplayServer();

  // Electron exposes window.electronAPI.liveplayServer via the preload
  // bridge. In a non-Electron / pure-web context we just fall back to
  // whatever URL the user persisted in localStorage (handled by the
  // composable's defaultUrl logic).
  const ep: any = (globalThis as any).electronAPI?.liveplayServer;

  if (ep) {
    try {
      const cfg = await ep.getConfig();
      const url = cfg.mode === 'remote'
        ? cfg.remoteUrl
        : `http://127.0.0.1:${cfg.localPort ?? 4480}`;
      server.setServerUrl(url);   // also reconnects internally
    } catch (e) {
      console.warn('[liveplay] failed to read Electron config:', e);
      server.connect();
    }

    // Re-target whenever main process tells us the config changed.
    ep.onStateChange?.((payload: any) => {
      const cfg = payload?.config;
      if (!cfg) return;
      const url = cfg.mode === 'remote'
        ? cfg.remoteUrl
        : `http://127.0.0.1:${cfg.localPort ?? 4480}`;
      if (url !== server.serverUrl) server.setServerUrl(url);
    });
  }
  // Pure web (no Electron): do NOT open the WebSocket here. The page's own
  // origin may be a plain static host with no /api or /ws (Mode B), in which
  // case a blind connect just spawns a failing reconnect loop that spams the
  // console. The WelcomeScreen owns the web connection flow — it probes
  // /api/health and only then calls setServerUrl()/connect().

  return {
    provide: { liveplay: server },
  };
});
