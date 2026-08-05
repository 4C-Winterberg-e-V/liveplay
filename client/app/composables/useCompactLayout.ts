// Single source of truth for the compact (phone / touch) layout queries.
//
// The same four query strings live in client/assets/styles/variables.scss as
// documentation and, literally, in each component's <style> block.
// `pnpm lp:bp-check` fails the build if any of them drift apart.
//
// The split that matters:
//   * isCompact / isWideShort describe GEOMETRY. Gate layout on them.
//   * isCoarse describes the INPUT DEVICE. Gate anything that can make sound
//     or change what a tap means on it — never on width.
//
// Why: `?cartWindow=1` renders CartPlayer on its own in a window Electron
// lets shrink to 380x400. That window *should* get the narrow layout, but a
// mouse click on a cart pad must keep selecting rather than firing a cue into
// the PA. Width is not a proxy for "this is a finger".
export const LP_COMPACT    = '(max-width: 767px), (max-width: 1024px) and (any-pointer: coarse), (max-height: 559px) and (any-pointer: coarse)';
export const LP_WIDE_SHORT = '(max-height: 559px) and (any-pointer: coarse) and (min-width: 600px)';
export const LP_COARSE     = '(any-pointer: coarse)';
export const LP_HOVERABLE  = '(any-hover: hover) and (any-pointer: fine)';
// The app is running without browser chrome — installed as a PWA in fullscreen,
// or put there by the Fullscreen API. Matters because Android's fullscreen also
// hides the SYSTEM STATUS BAR, taking the clock with it, and a show operator
// needs the time.
export const LP_FULLSCREEN = '(display-mode: fullscreen)';

// One listener per query for the whole app, however many components call the
// composable. Module-level because useState gives us a shared ref but not a
// shared "already subscribed" flag.
const subscribed = new Set<string>();

function useMediaState(key: string, query: string) {
  const state = useState<boolean>(key, () => false);
  if (import.meta.client && !subscribed.has(query)) {
    subscribed.add(query);
    const mq = window.matchMedia(query);
    state.value = mq.matches;
    // matchMedia is the only thing that fires reliably for rotation, for
    // mobile Safari's URL-bar collapse, AND for a pointer change. A hand-rolled
    // resize listener misses all three at least some of the time.
    mq.addEventListener('change', (e) => { state.value = e.matches; });
  }
  return state;
}

// Fullscreen needs one extra signal beyond the media query: the Fullscreen API
// is not reflected in `display-mode` by every engine, and the LAN share (plain
// http) can only ever reach fullscreen through that API, never through install.
function useFullscreenState() {
  const state = useState<boolean>('lp.fullscreen', () => false);
  if (import.meta.client && !subscribed.has(LP_FULLSCREEN)) {
    subscribed.add(LP_FULLSCREEN);
    const mq = window.matchMedia(LP_FULLSCREEN);
    const sync = () => { state.value = mq.matches || !!document.fullscreenElement; };
    sync();
    mq.addEventListener('change', sync);
    document.addEventListener('fullscreenchange', sync);
  }
  return state;
}

export const useCompactLayout = () => ({
  /** Phone-shaped viewport: narrow, or short with a touch screen. Layout only. */
  isCompact:    useMediaState('lp.compact',   LP_COMPACT),
  /** Phone in landscape with room for two panels side by side. Layout only. */
  isWideShort:  useMediaState('lp.wideShort', LP_WIDE_SHORT),
  /** A finger, not a mouse. Gate every audible or selection-semantic branch here. */
  isCoarse:     useMediaState('lp.coarse',    LP_COARSE),
  /** No browser chrome AND no system status bar — so the app owes the user a clock. */
  isFullscreen: useFullscreenState(),
});

/**
 * Toggle real fullscreen. This is the only way to reclaim the URL bar on the LAN
 * share, which serves plain http:// and therefore can never be installed as a
 * PWA (service workers and install both require a secure context).
 *
 * Returns false when the platform has no fullscreen at all — notably Safari on
 * iPhone, where `requestFullscreen` does not exist; there the answer is
 * "Add to Home Screen", which iOS honours via apple-mobile-web-app-capable.
 */
export const lpFullscreenSupported = (): boolean =>
  import.meta.client && !!document.fullscreenEnabled;

export const lpToggleFullscreen = async (): Promise<void> => {
  if (!import.meta.client) return;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch (err) {
    // A rejected request (no user gesture, or the platform refused) is not worth
    // breaking the UI over.
    console.warn('[fullscreen] toggle failed:', err);
  }
};
