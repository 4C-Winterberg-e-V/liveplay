// =====================================================================
// useShowControl.ts
// ---------------------------------------------------------------------
// Two-way sync for the operator UI state the SERVER owns:
//
//   * the selected playlist item   (ProjectState::selected_item_uuid)
//   * the display locale           (ProjectState::ui_locale)
//
// These used to be purely local (selection in useProject, locale in
// localStorage). They moved server-side so that a Bitfocus Companion surface,
// a touch tablet and the operator's laptop agree on the selected cue — a
// control surface that can't see what the operator has selected can't safely
// arm it.
//
// Show Mode is deliberately NOT in that list, though upstream had it here.
// Which cue is armed must be the same everywhere or the wrong thing fires;
// whether a given screen is large-and-simplified or small-and-complete is a
// property of THAT screen. Syncing it meant switching the phone into Show Mode
// also switched the laptop it was being operated from — and it made
// useUiMode's own per-device localStorage dead, because the first server
// snapshot overwrote whatever this device had remembered. Show Mode is
// per-device again and lives entirely in useUiMode (localStorage, plus
// storage-event / Electron IPC sync between windows of the SAME machine, which
// is what the detached cart player needs).
//
// The server still keeps a show_mode flag and still exposes set_show_mode over
// REST/WS, so nothing external breaks — but a Companion "Show Mode" button no
// longer moves these UIs. Re-wire here if that is ever wanted.
//
// This composable does NOT introduce a parallel store. It reads and writes
// the very same useState keys the rest of the app already binds to
// (`selectedItemUuid`, `locale`), so no component needs to change. Direction
// of travel:
//
//   server → client   playback_snapshot on (re)connect, then doc_patch ops
//                     (selection_changed / locale_changed)
//   client → server   watchers on those same refs
//
// Echo safety comes from both ends: the server only broadcasts when a value
// actually changes, and `applying` suppresses the watcher while we write a
// server value in. Pushes are also gated on `hydrated` so the locally
// restored (localStorage) locale can't clobber a running show's state in the
// fraction of a second before the first snapshot lands.
//
// Wired once per renderer from plugins/liveplay-server.client.ts.
// =====================================================================
import type { UiMode } from '~/composables/useUiMode';

// Renderer-scoped, not per-call: the plugin calls this once, but guard anyway
// so an accidental second call can't double-subscribe to the WS streams.
let _wired = false;

export const useShowControl = () => {
  const server = useLiveplayServer();

  // The same state keys useProject / useUiMode / useLocalization own.
  const selectedItemUuid = useState<string | null>('selectedItemUuid', () => null);
  const selectedItems    = useState<Set<string>>('selectedItems', () => new Set());
  const uiMode           = useState<UiMode>('useUiMode.uiMode', () => 'edit');
  const currentLocale    = useState<string>('locale', () => 'en');

  const showMode = computed(() => uiMode.value === 'playback');

  // Intent helpers for components/hotkeys that want to drive the shared
  // selection explicitly rather than mutating the ref.
  const select     = (uuid: string | null) => server.setSelection(uuid);
  const selectStep = (delta: number)       => server.stepSelection(delta);
  const selectNext = () => selectStep(1);
  const selectPrev = () => selectStep(-1);
  if (_wired || !import.meta.client) {
    return { selectedItemUuid, showMode, currentLocale,
             select, selectStep, selectNext, selectPrev };
  }
  _wired = true;

  // True while we're writing a server-sourced value into the refs — the
  // watchers below check this so an inbound patch never bounces back out.
  let applying = false;
  // Flipped by the first snapshot. Until then the refs still hold whatever
  // localStorage restored, which must not be pushed at a live server.
  let hydrated = false;

  const applyFromServer = (fn: () => void) => {
    applying = true;
    try { fn(); } finally { nextTick(() => { applying = false; }); }
  };

  const applySelection = (uuid: string | null) => {
    const next = uuid || null;
    if (selectedItemUuid.value === next) return;
    applyFromServer(() => {
      selectedItemUuid.value = next;
      // Keep the multi-select set in step: a server-driven selection is
      // always a single item (Companion has no shift-click), and leaving a
      // stale multi-selection behind would make a subsequent DEL delete
      // items the operator can no longer see highlighted.
      selectedItems.value = new Set(next ? [next] : []);
    });
  };

  const applyLocale = (code: string) => {
    if (!code || currentLocale.value === code) return;
    applyFromServer(() => { currentLocale.value = code; });
    try { localStorage.setItem('liveplay-locale', code); } catch { /* private browsing */ }
  };

  // ---- server → client ------------------------------------------------
  server.onPlaybackSnapshot((snap: any) => {
    if (!snap) return;
    applySelection(snap.selected_item_uuid ?? null);
    // snap.show_mode is deliberately ignored — see the header.
    if (typeof snap.locale === 'string') applyLocale(snap.locale);
    // Only now may local changes travel outward.
    hydrated = true;
  });

  server.onDocPatch((patch: any) => {
    if (!patch || typeof patch !== 'object') return;
    switch (patch.op) {
      case 'selection_changed':
        applySelection(patch.itemUuid ?? null);
        break;
      case 'locale_changed':
        if (typeof patch.locale === 'string') applyLocale(patch.locale);
        break;
    }
  });

  // ---- client → server ------------------------------------------------
  // Watching the refs (rather than patching every call site) means clicks in
  // the playlist, arrow keys, MIDI and the language picker all publish for
  // free, whichever path they took to change the value.
  watch(selectedItemUuid, (uuid) => {
    if (applying || !hydrated) return;
    server.setSelection(uuid ?? null);
  });

  watch(currentLocale, (code) => {
    if (applying || !hydrated || !code) return;
    server.setServerLocale(code);
  });

  return { selectedItemUuid, showMode, currentLocale,
           select, selectStep, selectNext, selectPrev };
};
