import {
  X18_UNITY_POS,
  clampPos,
  x18PosToPercent,
  type X18Strip,
} from '~/utils/x18Fader';

// Live channel/bus/master levels on the Behringer X18.
//
// The console never tells us anything: `/api/x18/action` is fire-and-forget
// OSC over UDP and there is no read-back path. So this composable owns the
// only level state that exists — "what this app last sent" — and is careful to
// say so rather than pretend it is a reading. A strip the operator has not
// touched is marked unsent, and the UI dims its value instead of claiming the
// desk sits at 0 dB.
//
// Positions are 0..1 (the console's own fader argument); the REST call takes
// percent. See ~/utils/x18Fader for the maths.

/** Never exceed ~22 commands/s per strip. A drag emits a pointermove per frame
 *  (60-120/s); every one of those became an HTTP POST until this existed. */
const MIN_SEND_GAP_MS = 45;
/** A fader command is worthless the moment it is late — this is a live desk, not
 *  a form submission. Two orders of magnitude above a LAN round trip, far below
 *  the OS's own connection timeout. It also bounds how long a stalled request
 *  can hold the one-in-flight slot: only one command per strip may be
 *  outstanding (two in flight can land out of order, and on a fader the wrong
 *  one landing last is the wrong level), so this is also the worst case for how
 *  long a newer move can wait behind a dead one. */
const SEND_TIMEOUT_MS = 1500;
/** Enough to ride out an AP roam; few enough that a genuinely dead link stops
 *  and shows the operator the failure instead of retrying behind their back. */
const MAX_RETRIES = 4;
const STORAGE_PREFIX = 'liveplay.x18.faders.';

interface StripSendState {
  queued: number | null;
  sending: boolean;
  lastSentAt: number;
  retries: number;
  timer: ReturnType<typeof setTimeout> | null;
}

// Module scope, not per-call: every strip component calls the composable, and
// they must share one scheduler or the rate limit is per-component and useless.
const sendState = new Map<string, StripSendState>();
// Levels the console actually acknowledged. This — not what is on screen — is
// what gets cached, so a reload never restores a value that only ever existed
// as an unsent intention.
const delivered = new Map<string, number>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;

const stateFor = (id: string): StripSendState => {
  let s = sendState.get(id);
  if (!s) {
    s = { queued: null, sending: false, lastSentAt: 0, retries: 0, timer: null };
    sendState.set(id, s);
  }
  return s;
};

/** Longest strip name we keep. Enough for "Funke Pfarrer Handheld", short
 *  enough that it can never push the level readout off a phone. */
const MAX_NAME_LEN = 24;

export const useX18Faders = () => {
  const { currentProject, saveProject } = useProject();
  const server = useLiveplayServer();

  // Fader position per strip id, 0..1. Shared across every component instance.
  const positions = useState<Record<string, number>>('x18.faderPos', () => ({}));
  // Strips this app has actually sent a level to. Anything else is a guess.
  const sent = useState<Record<string, boolean>>('x18.faderSent', () => ({}));
  // Last command for this strip failed (server down, Wi-Fi dropped mid-show).
  const failed = useState<Record<string, boolean>>('x18.faderFailed', () => ({}));
  // Guards the one-time restore from localStorage.
  const restoredFor = useState<string>('x18.faderRestoredFor', () => '');

  const consoleIp = computed<string>(() => {
    const ip = (currentProject.value as any)?.settings?.x18Ip;
    return typeof ip === 'string' ? ip.trim() : '';
  });
  const isConfigured = computed(() => consoleIp.value.length > 0);

  // Keyed by console, not by project: a fader position describes a desk. Point
  // the app at a different X18 and the levels are unknown again, which is the
  // truth. Phone browsers evict backgrounded tabs aggressively, and coming back
  // to "everything at 0 dB" while the desk is somewhere else is the failure
  // this restore exists to prevent.
  const storageKey = computed(() => STORAGE_PREFIX + (consoleIp.value || 'none'));

  const writeNow = () => {
    if (!import.meta.client || !isConfigured.value) return;
    try {
      const payload: Record<string, number> = {};
      for (const [id, pos] of delivered) payload[id] = Math.round(pos * 10000) / 10000;
      localStorage.setItem(storageKey.value, JSON.stringify(payload));
    } catch { /* quota or private mode — losing the cache is not worth an error */ }
  };

  // localStorage.setItem is synchronous and serialises every strip. A drag lands
  // ~20 sends a second; doing this on each of them would put a JSON.stringify +
  // disk write on the main thread between the finger and the fader.
  const persist = () => {
    if (persistTimer !== null) return;
    persistTimer = setTimeout(() => { persistTimer = null; writeNow(); }, 400);
  };

  const restore = () => {
    if (!import.meta.client || !isConfigured.value) return;
    const key = storageKey.value;
    if (restoredFor.value === key) return;
    restoredFor.value = key;
    // Start from nothing, not from what is on screen. Re-pointing the project at
    // a different desk must not leave the previous desk's levels showing for
    // every strip the new one has no cache for — those are somebody else's
    // numbers, and here they would read as this console's.
    const nextPos: Record<string, number> = {};
    const nextSent: Record<string, boolean> = {};
    delivered.clear();
    sendState.clear();
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (parsed && typeof parsed === 'object') {
        for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
          const n = Number(value);
          if (!Number.isFinite(n)) continue;
          nextPos[id] = clampPos(n);
          nextSent[id] = true;
          delivered.set(id, clampPos(n));
        }
      }
    } catch { /* corrupt cache is the same as no cache */ }
    positions.value = nextPos;
    sent.value = nextSent;
    failed.value = {};
  };

  /** Position of a strip; unity for anything never touched. */
  const positionOf = (strip: X18Strip): number =>
    positions.value[strip.id] ?? X18_UNITY_POS;

  const isSent = (strip: X18Strip): boolean => !!sent.value[strip.id];
  const hasFailed = (strip: X18Strip): boolean => !!failed.value[strip.id];

  // `rest()` calls fetch with no AbortSignal, and a phone that walks out of Wi-Fi
  // range does not get a rejection — the request hangs until the OS gives up,
  // which on iOS is over a minute. `sending` would stay true for that whole
  // time and every later move on this strip would queue behind a request that
  // is never coming back, so the fader would keep moving on screen while the
  // desk heard nothing. Our own deadline turns that into an ordinary failure.
  const dispatch = (strip: X18Strip, pos: number) => {
    const call = server.x18Action({
      kind: 'fader',
      target: strip.kind,
      ...(strip.index === undefined ? {} : { channel: strip.index }),
      level: x18PosToPercent(pos),
    });
    return Promise.race([
      call,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('x18 fader command timed out')), SEND_TIMEOUT_MS)),
    ]);
  };

  // One request in flight per strip, and never more than one per MIN_SEND_GAP_MS.
  // A value that arrives while a request is out replaces the queued one, so a
  // drag costs a bounded number of requests and the finger's LAST position is
  // always the one the desk ends up at.
  const flush = async (strip: X18Strip) => {
    const s = stateFor(strip.id);
    s.timer = null;
    if (s.sending) return;
    const pos = s.queued;
    if (pos === null) return;
    s.queued = null;
    s.sending = true;
    s.lastSentAt = Date.now();
    try {
      await dispatch(strip, pos);
      s.retries = 0;
      delivered.set(strip.id, pos);
      if (failed.value[strip.id]) failed.value = { ...failed.value, [strip.id]: false };
      persist();
    } catch (e) {
      console.warn('[x18Faders] fader command failed:', e);
      failed.value = { ...failed.value, [strip.id]: true };
      // Put the level back in the queue. Dropping it would leave the desk on
      // whichever value last happened to succeed while the phone shows the
      // operator's intent — a silent divergence that survives until somebody
      // touches that fader again. A newer value already waiting always wins.
      if (s.queued === null && s.retries < MAX_RETRIES) {
        s.retries++;
        s.queued = pos;
      }
    } finally {
      s.sending = false;
      if (s.queued !== null) schedule(strip);
    }
  };

  const schedule = (strip: X18Strip) => {
    const s = stateFor(strip.id);
    if (s.sending || s.timer !== null) return;
    // Back off while retrying so a dead link is not hammered at 22 requests a
    // second; a fresh move resets `retries` on the next success.
    const gap = s.retries > 0 ? MIN_SEND_GAP_MS * (1 << Math.min(s.retries, 5)) : MIN_SEND_GAP_MS;
    const wait = Math.max(0, gap - (Date.now() - s.lastSentAt));
    if (wait === 0) { void flush(strip); return; }
    s.timer = setTimeout(() => { void flush(strip); }, wait);
  };

  /**
   * Move a strip. The UI updates immediately and unconditionally — a fader that
   * lags the finger by a network round-trip is unusable — and the console
   * catches up at the rate limit.
   */
  const setPosition = (strip: X18Strip, pos: number) => {
    const next = clampPos(pos);
    const current = positions.value[strip.id];
    // Already there AND the desk has been told — nothing to send. Without this
    // a held "−" at the bottom of the law, or a drag past either end, keeps
    // firing identical commands at the console for as long as the finger stays
    // down. The `sent` half matters: the FIRST press on an untouched strip must
    // go out even when the position happens to equal the assumed unity.
    if (current === next && sent.value[strip.id]) return;
    if (current !== next) {
      positions.value = { ...positions.value, [strip.id]: next };
    }
    if (!isConfigured.value) return;   // banner already tells the operator why
    if (!sent.value[strip.id]) sent.value = { ...sent.value, [strip.id]: true };
    stateFor(strip.id).queued = next;
    schedule(strip);
  };

  // ---- Strip names --------------------------------------------------------
  // "CH 3" is the label on the desk; it tells the person holding the phone
  // nothing about which microphone is too loud. Names are part of the project,
  // so naming the desk once on any device names it on all of them.
  const nameOf = (strip: X18Strip): string => {
    const names = (currentProject.value as any)?.settings?.x18StripNames;
    const custom = names && typeof names === 'object' ? names[strip.id] : undefined;
    return typeof custom === 'string' && custom.trim().length > 0 ? custom.trim() : '';
  };

  const setName = (strip: X18Strip, raw: string) => {
    const p = currentProject.value as any;
    if (!p) return;
    if (!p.settings || typeof p.settings !== 'object') p.settings = {};
    const names: Record<string, string> = { ...(p.settings.x18StripNames ?? {}) };
    const name = raw.trim().slice(0, MAX_NAME_LEN);
    if (name) names[strip.id] = name;
    else delete names[strip.id];   // cleared → fall back to the desk label
    p.settings = { ...p.settings, x18StripNames: names };
    saveProject();
  };

  return {
    consoleIp,
    isConfigured,
    nameOf,
    setName,
    positionOf,
    isSent,
    hasFailed,
    setPosition,
    restore,
  };
};
