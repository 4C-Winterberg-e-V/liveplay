// Register the service worker, but only where it can actually work.
//
// Three places this must NOT run:
//   * Electron — the app is loaded from file://, there is no origin to scope a
//     worker to, and the desktop build has no URL bar to reclaim anyway.
//   * The LAN web share — it serves plain http://<host>:8088, and service
//     workers require a secure context. Attempting registration there throws a
//     console error on every load for no benefit.
//   * The detached cart window (?cartWindow=1) — same origin, already covered by
//     the main window's registration.
//
// Over the Cloudflare tunnel (https://…) it registers and the app becomes
// installable, which is the point: installing removes the browser chrome.
export default defineNuxtPlugin(() => {
  if (!import.meta.client) return;
  if ((window as any).electronAPI) return;
  if (!('serviceWorker' in navigator)) return;
  // isSecureContext is true for https:// and for localhost, false for a LAN IP
  // over http — exactly the distinction that matters here.
  if (!window.isSecureContext) return;

  const register = () => {
    // Scope to the app's base path so a sub-path deployment
    // (NUXT_APP_BASE_URL=/liveplay/) registers under its own scope rather than
    // claiming the whole origin.
    const base = useRuntimeConfig().app.baseURL || '/';
    navigator.serviceWorker.register(`${base}sw.js`.replace(/\/{2,}/g, '/'), { scope: base })
      .catch((err) => {
        // Not fatal: without a worker the app still runs, it just may not offer
        // to install.
        console.warn('[pwa] service worker registration failed:', err);
      });
  };

  // A Nuxt client plugin can run after `load` has already fired, in which case a
  // listener for it never runs and the worker is never registered — so check the
  // ready state rather than assuming the event is still ahead of us.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
});
