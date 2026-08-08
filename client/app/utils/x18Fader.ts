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
export const X18_MIN_POS = 0;
export const X18_MAX_POS = 1;
/** Top of the X-Air fader law. */
export const X18_MAX_DB = 10;
/** Lowest dB the law resolves. Below this the console is off (−∞). */
export const X18_MIN_DB = -90;

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

/** Same value, but ASCII — for aria-valuetext, where a screen reader wins. */
export const spokenX18Db = (db: number): string => {
  if (!Number.isFinite(db)) return db > 0 ? 'infinity dB' : 'minus infinity dB';
  const rounded = Math.round(db * 10) / 10;
  return `${Object.is(rounded, -0) ? 0 : rounded} dB`;
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

export type X18StripKind = 'master' | 'channel' | 'bus';

/** One controllable level on the console. `id` is our own state key. */
export interface X18Strip {
  id: string;
  kind: X18StripKind;
  /** 1-based channel (1..16) or bus (1..6); absent for master. */
  index?: number;
  /** Short label, e.g. "CH 1" / "BUS 3" / "LR". Not translated: these are the
   *  labels printed on the desk. */
  short: string;
}

export const x18StripId = (kind: X18StripKind, index?: number): string =>
  kind === 'master' ? 'master' : `${kind}:${index}`;

const stripFor = (kind: X18StripKind, index?: number): X18Strip => ({
  id: x18StripId(kind, index),
  kind,
  ...(index === undefined ? {} : { index }),
  short: kind === 'master' ? 'LR' : kind === 'bus' ? `BUS ${index}` : `CH ${index}`,
});

export const X18_MASTER_STRIP: X18Strip = stripFor('master');
export const X18_CHANNEL_STRIPS: X18Strip[] =
  Array.from({ length: X18_CHANNEL_COUNT }, (_, i) => stripFor('channel', i + 1));
export const X18_BUS_STRIPS: X18Strip[] =
  Array.from({ length: X18_BUS_COUNT }, (_, i) => stripFor('bus', i + 1));

export type X18FaderScope = 'channels' | 'buses' | 'master';

export const x18StripsForScope = (scope: X18FaderScope): X18Strip[] => {
  if (scope === 'buses') return X18_BUS_STRIPS;
  if (scope === 'master') return [X18_MASTER_STRIP];
  return X18_CHANNEL_STRIPS;
};

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
