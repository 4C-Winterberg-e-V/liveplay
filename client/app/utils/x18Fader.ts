// Behringer X18 / X-Air fader maths and the strip list of an X18/XR18.
//
// Pure, dependency-free, and therefore unit-testable — the Vue side only wraps
// this. Everything here speaks *fader position* (0..1), which is exactly what
// the console's OSC `/…/mix/fader` argument is and what the physical fader
// travel represents. Percent is what our own server API takes (0..100, it just
// divides by 100 again), and dB is what an operator reads off the console.

/** Fader position of unity gain (0 dB) on an X-Air desk. */
export const X18_UNITY_POS = 0.75;
/** Position range the console accepts. 0 is "fader all the way down" (−∞). */
const X18_MIN_POS = 0;
const X18_MAX_POS = 1;
/** Top of the X-Air fader law. */
const X18_MAX_DB = 10;
/** Lowest dB the law resolves. Below this the console is off (−∞). */
const X18_MIN_DB = -90;

export const X18_CHANNEL_COUNT = 16;
export const X18_BUS_COUNT = 6;

export const clampPos = (pos: number): number => {
  if (!Number.isFinite(pos)) return 0;
  return Math.min(X18_MAX_POS, Math.max(X18_MIN_POS, pos));
};

// The X32/X-Air fader law is piecewise linear in *position*, not in dB — which
// is why a fader feels fine near unity and coarse at the bottom. The four
// segments below are the published mapping; each boundary is shared by the two
// segments that meet there (pos .5 → −10, .25 → −30, .0625 → −60), so the curve
// is continuous.
export const x18PosToDb = (pos: number): number => {
  const p = clampPos(pos);
  if (p <= 0) return -Infinity;          // fader down == off, not −90 dB
  if (p >= 0.5) return 40 * p - 30;      // −10 … +10 dB
  if (p >= 0.25) return 80 * p - 50;     // −30 … −10 dB
  if (p >= 0.0625) return 160 * p - 70;  // −60 … −30 dB
  return 480 * p - 90;                   // −90 … −60 dB
};

export const x18DbToPos = (db: number): number => {
  if (!Number.isFinite(db)) return db > 0 ? 1 : 0;   // ±∞ → top / off
  if (db >= X18_MAX_DB) return 1;
  if (db <= X18_MIN_DB) return 0;
  if (db >= -10) return clampPos((db + 30) / 40);
  if (db >= -30) return clampPos((db + 50) / 80);
  if (db >= -60) return clampPos((db + 70) / 160);
  return clampPos((db + 90) / 480);
};

/** What our own REST endpoint wants: level 0..100. */
export const x18PosToPercent = (pos: number): number =>
  Math.round(clampPos(pos) * 1000) / 10;

/**
 * Console-style dB readout. Uses the typographic minus (−) so a negative value
 * is legible at 12px on a phone, and "−∞" for a closed fader — the same
 * convention VolumeSlider already uses for cue gain.
 */
export const formatX18Db = (db: number): string => {
  if (!Number.isFinite(db)) return db > 0 ? '+∞' : '−∞';
  const rounded = Math.round(db * 10) / 10;
  if (Object.is(rounded, -0) || rounded === 0) return '0.0';
  const body = Math.abs(rounded).toFixed(1);
  return (rounded > 0 ? '+' : '−') + body;
};

/**
 * Step a level by `deltaDb`, in dB, and return the new *position*.
 * Stepping in dB (not position) is what makes a "+" button feel like a console
 * trim; a closed fader steps up from the very bottom of the law rather than
 * from −∞, which would be a no-op forever.
 */
export const stepPosByDb = (pos: number, deltaDb: number): number => {
  const current = x18PosToDb(pos);
  const base = Number.isFinite(current) ? current : X18_MIN_DB;
  const next = Math.round((base + deltaDb) * 10) / 10;
  if (next <= X18_MIN_DB) return 0;
  return x18DbToPos(next);
};

// ---------------------------------------------------------------------------
// OSC addresses.
//
// These MUST agree byte for byte with the server's builders in
// server/include/liveplay/net/x18_addresses.hpp — the server keys its cache of
// console values by address, and the client looks levels up by the same key. A
// mismatch shows an operator a permanently blank fader with no error anywhere.
// Both sides are unit-tested against the same literal strings.
//
// The console's zero-padding is inconsistent on purpose: channels and send
// indices are two digits, bus masters are one.
// ---------------------------------------------------------------------------

/** Which mix: the main LR bus, or one of the six numbered buses. */
export type X18Mix = 'lr' | number;

export const X18_BUS_MIN = 1;
export const X18_BUS_MAX = 6;

const isBus = (bus: X18Mix): bus is number =>
  typeof bus === 'number' && Number.isInteger(bus) && bus >= X18_BUS_MIN && bus <= X18_BUS_MAX;

const isChannel = (ch: number): boolean =>
  Number.isInteger(ch) && ch >= 1 && ch <= X18_CHANNEL_COUNT;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** A mix's own output level: main LR, or a bus master. '' when out of range. */
export const x18MixAddress = (bus: X18Mix): string => {
  if (bus === 'lr') return '/lr/mix/fader';
  if (!isBus(bus)) return '';
  return `/bus/${bus}/mix/fader`;
};

/**
 * A channel's level within one mix. In the main mix that IS the channel fader;
 * in a bus it is the send level, which is a different parameter with a
 * different address shape. '' when the channel or bus is off the desk.
 */
export const x18ChannelMixAddress = (channel: number, bus: X18Mix): string => {
  if (!isChannel(channel)) return '';
  if (bus === 'lr') return `/ch/${pad2(channel)}/mix/fader`;
  if (!isBus(bus)) return '';
  return `/ch/${pad2(channel)}/mix/${pad2(bus)}/level`;
};

/**
 * Beside every level on the desk sits an on/off switch, which is what an
 * operator calls mute. Note the sense: the console's value is 1 for AUDIBLE and
 * 0 for MUTED — the opposite of the word. Nothing outside the two converters
 * below should ever handle that raw value, because getting it backwards
 * silences a live channel instead of restoring it.
 */
export const x18MixMuteAddress = (bus: X18Mix): string => {
  if (bus === 'lr') return '/lr/mix/on';
  if (!isBus(bus)) return '';
  return `/bus/${bus}/mix/on`;
};

/** A channel's on/off in one mix: its own switch in the main mix, its send's in a bus. */
export const x18ChannelMixMuteAddress = (channel: number, bus: X18Mix): string => {
  if (!isChannel(channel)) return '';
  if (bus === 'lr') return `/ch/${pad2(channel)}/mix/on`;
  if (!isBus(bus)) return '';
  return `/ch/${pad2(channel)}/mix/${pad2(bus)}/on`;
};

/** Console `on` value -> muted. */
export const x18OnToMuted = (on: number): boolean => on < 0.5;
/** muted -> the console's `on` value. */
export const x18MutedToOn = (muted: boolean): number => (muted ? 0 : 1);

// ---------------------------------------------------------------------------
// The operator's fader list.
//
// Not a fixed grid of every channel on every bus — that is 119 faders nobody
// asked for. The operator adds the handful that matter for their show: "the
// wireless mic in the monitor", "the bus that feeds the foyer". Each entry is
// either a mix's own output level or one channel's level inside one mix.
// ---------------------------------------------------------------------------

export type X18FaderKind = 'mix' | 'send';

export interface X18FaderEntry {
  id: string;
  /** What the operator called it. Empty falls back to the structural label. */
  label?: string;
  kind: X18FaderKind;
  /** Which mix this entry lives in: 'lr' for the main mix, 1-6 for a bus. */
  bus: X18Mix;
  /** 1-16. Only meaningful for kind 'send'. */
  channel?: number;
}

/** The OSC address an entry controls, or '' if it describes nothing real. */
export const x18EntryAddress = (entry: X18FaderEntry): string => {
  if (!entry) return '';
  if (entry.kind === 'mix') return x18MixAddress(entry.bus);
  return x18ChannelMixAddress(entry.channel ?? 0, entry.bus);
};

/** The on/off address that goes with that level. */
export const x18EntryMuteAddress = (entry: X18FaderEntry): string => {
  if (!entry) return '';
  if (entry.kind === 'mix') return x18MixMuteAddress(entry.bus);
  return x18ChannelMixMuteAddress(entry.channel ?? 0, entry.bus);
};

/** Short name of a mix as the desk prints it. */
export const x18MixLabel = (bus: X18Mix): string =>
  bus === 'lr' ? 'MAIN LR' : isBus(bus) ? `BUS ${bus}` : '?';

/**
 * What the strip shows when the operator has not named it: the route, in the
 * desk's own terms. "CH 3 -> BUS 2" says more than "Fader 4" ever could, and it
 * is the same in every language.
 */
export const x18EntryTag = (entry: X18FaderEntry): string => {
  if (!entry) return '?';
  if (entry.kind === 'mix') return x18MixLabel(entry.bus);
  const ch = isChannel(entry.channel ?? 0) ? `CH ${entry.channel}` : 'CH ?';
  return `${ch} \u2192 ${x18MixLabel(entry.bus)}`;
};

/** True when the entry addresses something the console actually has. */
export const isValidX18Entry = (entry: X18FaderEntry): boolean =>
  !!entry && x18EntryAddress(entry).length > 0;

/** Two entries that drive the same console parameter. */
export const isSameX18Target = (a: X18FaderEntry, b: X18FaderEntry): boolean =>
  x18EntryAddress(a) !== '' && x18EntryAddress(a) === x18EntryAddress(b);

/**
 * How much of a drag translates into level, from how far the finger has strayed
 * off the track. A phone fader is ~280px wide for the whole law, which is
 * already ~0.14 dB per pixel near unity — good enough to mix with. Straying
 * further makes it finer still, the way an iOS slider does, and is the reason
 * the ± buttons are a convenience rather than the only precise path.
 */
export const dragSensitivity = (offAxisPx: number): number => {
  const d = Math.abs(offAxisPx);
  if (d < 48) return 1;
  if (d < 104) return 0.4;
  if (d < 184) return 0.15;
  return 0.05;
};
