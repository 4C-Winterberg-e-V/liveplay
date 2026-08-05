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
export const LP_HOVERABLE  = '(hover: hover) and (pointer: fine)';

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

export const useCompactLayout = () => ({
  /** Phone-shaped viewport: narrow, or short with a touch screen. Layout only. */
  isCompact:    useMediaState('lp.compact',   LP_COMPACT),
  /** Phone in landscape with room for two panels side by side. Layout only. */
  isWideShort:  useMediaState('lp.wideShort', LP_WIDE_SHORT),
  /** A finger, not a mouse. Gate every audible or selection-semantic branch here. */
  isCoarse:     useMediaState('lp.coarse',    LP_COARSE),
});
