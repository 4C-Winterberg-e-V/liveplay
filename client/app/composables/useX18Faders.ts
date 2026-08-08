import {
  clampPos,
  x18EntryAddress,
  x18PosToPercent,
  type X18FaderEntry,
  type X18Mix,
} from '~/utils/x18Fader';

// The operator's X18 fader list, and the console state behind it.
//
// This used to own the level state, because the server could only send OSC and
// the desk never answered. It does now: net::X18Link keeps a subscription open,
// asks the console for every parameter it cares about, and pushes what comes
// back. So the values here are the DESK's, not ours — arriving over the same
// WebSocket as everything else, whether they were changed from this phone,
// another phone, or by a hand on the physical fader.
//
// What is still ours: which faders the operator wants on screen (an entry list
// in project settings), and the write path, which is rate-limited because a
// drag emits a pointermove per frame and the console is a small embedded device
// at the end of a Wi-Fi link.

/** Never exceed ~22 commands/s per fader. */
const MIN_SEND_GAP_MS = 45;
/** A fader command is worthless the moment it is late, and `rest()` has no
 *  timeout of its own — a phone walking out of range would otherwise wedge a
 *  fader for as long as the OS takes to give up on the socket. */
const SEND_TIMEOUT_MS = 1500;
const MAX_RETRIES = 4;
/** Longest entry name we keep. */
const MAX_LABEL_LEN = 32;

interface SendState {
  queued: number | null;
  sending: boolean;
  lastSentAt: number;
  retries: number;
  timer: ReturnType<typeof setTimeout> | null;
}

// Module scope: every strip component calls the composable and they have to
// share one scheduler, or the rate limit is per-component and therefore not one.
const sendState = new Map<string, SendState>();
// Addresses a finger is currently on. The desk echoes our own writes, and a
// several-hundred-millisecond-old echo arriving mid-drag would yank the fader
// backwards under the thumb.
const held = new Set<string>();

const stateFor = (address: string): SendState => {
  let s = sendState.get(address);
  if (!s) {
    s = { queued: null, sending: false, lastSentAt: 0, retries: 0, timer: null };
    sendState.set(address, s);
  }
  return s;
};

const genId = (): string => {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* noop */ }
  return 'x18f-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
};

export const useX18Faders = () => {
  const { currentProject, saveProject } = useProject();
  const server = useLiveplayServer();

  /** Everything the server has heard from the desk, keyed by OSC address. */
  const values = useState<Record<string, number>>('x18.values', () => ({}));
  /** True once the console has answered at least one query. */
  const linkUp = useState<boolean>('x18.linkUp', () => false);
  /** Addresses whose last write did not reach the console. */
  const failed = useState<Record<string, boolean>>('x18.sendFailed', () => ({}));

  const consoleIp = computed<string>(() => {
    const ip = (currentProject.value as any)?.settings?.x18Ip;
    return typeof ip === 'string' ? ip.trim() : '';
  });
  const isConfigured = computed(() => consoleIp.value.length > 0);

  // ---- The operator's list -------------------------------------------------
  // Lives in `settings` rather than as a top-level project key: the C++ server
  // whitelists which project keys it hands back to clients, and `settings` is
  // the one object it passes through verbatim. So this syncs to every device
  // and survives a server that predates the feature — which then simply cannot
  // read the console, instead of losing the operator's list.
  const entries = computed<X18FaderEntry[]>(() => {
    const list = (currentProject.value as any)?.settings?.x18Faders;
    return Array.isArray(list) ? (list as X18FaderEntry[]) : [];
  });

  const writeEntries = (next: X18FaderEntry[]) => {
    const p = currentProject.value as any;
    if (!p) return;
    if (!p.settings || typeof p.settings !== 'object') p.settings = {};
    p.settings = { ...p.settings, x18Faders: next };
    saveProject();
  };

  const addEntry = (entry: Omit<X18FaderEntry, 'id'>): string => {
    const id = genId();
    const label = (entry.label ?? '').trim().slice(0, MAX_LABEL_LEN);
    writeEntries([...entries.value, { ...entry, id, label }]);
    return id;
  };

  const updateEntry = (id: string, patch: Partial<X18FaderEntry>) => {
    writeEntries(entries.value.map(e => {
      if (e.id !== id) return e;
      const next = { ...e, ...patch, id: e.id };
      if (next.label !== undefined) next.label = String(next.label).trim().slice(0, MAX_LABEL_LEN);
      // A mix entry has no channel; leaving a stale one behind would make the
      // stored document lie about what the fader does.
      if (next.kind === 'mix') delete next.channel;
      return next;
    }));
  };

  const removeEntry = (id: string) => {
    writeEntries(entries.value.filter(e => e.id !== id));
  };

  /** Move an entry by `delta` places, clamped. Order is the operator's. */
  const moveEntry = (id: string, delta: number) => {
    const list = [...entries.value];
    const from = list.findIndex(e => e.id === id);
    if (from < 0) return;
    const to = Math.max(0, Math.min(list.length - 1, from + delta));
    if (to === from) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved!);
    writeEntries(list);
  };

  // ---- Reading the desk ----------------------------------------------------
  const applyValues = (incoming: Record<string, unknown> | null | undefined) => {
    if (!incoming || typeof incoming !== 'object') return;
    const next = { ...values.value };
    let changed = false;
    for (const [address, raw] of Object.entries(incoming)) {
      if (held.has(address)) continue;      // a finger owns this one right now
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      const clamped = clampPos(n);
      if (next[address] !== clamped) { next[address] = clamped; changed = true; }
    }
    if (changed) values.value = next;
  };

  /** Pull the whole picture. Cheap, and the only thing a joining client needs. */
  const refresh = async () => {
    if (!isConfigured.value) {
      values.value = {};
      linkUp.value = false;
      return;
    }
    try {
      const state = await server.x18State();
      values.value = {};                     // a fresh read replaces, never merges
      applyValues(state?.values);
      linkUp.value = Object.keys(state?.values ?? {}).length > 0;
    } catch (e) {
      console.warn('[x18Faders] could not read console state:', e);
      linkUp.value = false;
    }
  };

  /** Position of an entry, or undefined when the desk has not answered yet. */
  const positionOf = (entry: X18FaderEntry): number | undefined => {
    const address = x18EntryAddress(entry);
    return address ? values.value[address] : undefined;
  };

  const hasFailed = (entry: X18FaderEntry): boolean => {
    const address = x18EntryAddress(entry);
    return !!address && !!failed.value[address];
  };

  /** While true, echoes for this entry are ignored — a finger is on it. */
  const setHeld = (entry: X18FaderEntry, on: boolean) => {
    const address = x18EntryAddress(entry);
    if (!address) return;
    if (on) held.add(address); else held.delete(address);
  };

  // ---- Writing to the desk -------------------------------------------------
  const dispatch = (entry: X18FaderEntry, pos: number) => {
    const level = x18PosToPercent(pos);
    const bus: X18Mix = entry.bus;
    const call = entry.kind === 'mix'
      ? server.x18Action({ kind: 'mix', bus, level })
      : server.x18Action({ kind: 'send', bus, channel: entry.channel, level });
    return Promise.race([
      call,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('x18 fader command timed out')), SEND_TIMEOUT_MS)),
    ]);
  };

  const flush = async (entry: X18FaderEntry, address: string) => {
    const s = stateFor(address);
    s.timer = null;
    if (s.sending) return;
    const pos = s.queued;
    if (pos === null) return;
    s.queued = null;
    s.sending = true;
    s.lastSentAt = Date.now();
    try {
      await dispatch(entry, pos);
      s.retries = 0;
      if (failed.value[address]) failed.value = { ...failed.value, [address]: false };
    } catch (e) {
      console.warn('[x18Faders] fader command failed:', e);
      failed.value = { ...failed.value, [address]: true };
      // Put it back. Dropping it would leave the desk on whichever value last
      // happened to land while the phone shows the operator's intent.
      if (s.queued === null && s.retries < MAX_RETRIES) {
        s.retries++;
        s.queued = pos;
      }
    } finally {
      s.sending = false;
      if (s.queued !== null) schedule(entry, address);
    }
  };

  const schedule = (entry: X18FaderEntry, address: string) => {
    const s = stateFor(address);
    if (s.sending || s.timer !== null) return;
    const gap = s.retries > 0 ? MIN_SEND_GAP_MS * (1 << Math.min(s.retries, 5)) : MIN_SEND_GAP_MS;
    const wait = Math.max(0, gap - (Date.now() - s.lastSentAt));
    if (wait === 0) { void flush(entry, address); return; }
    s.timer = setTimeout(() => { void flush(entry, address); }, wait);
  };

  /**
   * Move a fader. The local value updates immediately — a fader that lags the
   * finger by a round trip is unusable — and the console catches up at the rate
   * limit, then confirms with its own echo.
   */
  const setPosition = (entry: X18FaderEntry, pos: number) => {
    const address = x18EntryAddress(entry);
    if (!address) return;
    const next = clampPos(pos);
    if (values.value[address] !== next) {
      values.value = { ...values.value, [address]: next };
    }
    if (!isConfigured.value) return;
    stateFor(address).queued = next;
    schedule(entry, address);
  };

  return {
    consoleIp,
    isConfigured,
    linkUp,
    values,
    entries,
    addEntry,
    updateEntry,
    removeEntry,
    moveEntry,
    positionOf,
    hasFailed,
    setHeld,
    setPosition,
    refresh,
    applyValues,
  };
};
