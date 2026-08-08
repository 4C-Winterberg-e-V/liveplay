import { describe, it, expect } from 'vitest';
import {
  X18_BUS_STRIPS,
  X18_CHANNEL_STRIPS,
  X18_MASTER_STRIP,
  X18_UNITY_POS,
  clampPos,
  dragSensitivity,
  formatX18Db,
  spokenX18Db,
  stepPosByDb,
  x18DbToPos,
  x18PosToDb,
  x18PosToPercent,
  x18StripId,
  x18StripsForScope,
} from '../app/utils/x18Fader';

// The fader law here IS the X32/X-Air law. If these anchors ever move, a
// channel labelled "0 dB" in LivePlay stops meaning 0 dB on the desk, which is
// the kind of bug you only find during a show.
describe('x18PosToDb', () => {
  it('hits the published anchor points', () => {
    expect(x18PosToDb(1)).toBeCloseTo(10, 6);
    expect(x18PosToDb(X18_UNITY_POS)).toBeCloseTo(0, 6);
    expect(x18PosToDb(0.5)).toBeCloseTo(-10, 6);
    expect(x18PosToDb(0.25)).toBeCloseTo(-30, 6);
    expect(x18PosToDb(0.0625)).toBeCloseTo(-60, 6);
  });

  it('treats a closed fader as off, not as -90 dB', () => {
    expect(x18PosToDb(0)).toBe(-Infinity);
  });

  it('is continuous across every segment boundary', () => {
    for (const edge of [0.5, 0.25, 0.0625]) {
      const below = x18PosToDb(edge - 1e-9);
      const above = x18PosToDb(edge + 1e-9);
      expect(Math.abs(above - below)).toBeLessThan(1e-5);
    }
  });

  it('rises monotonically over the whole travel', () => {
    let prev = -Infinity;
    for (let i = 1; i <= 1000; i++) {
      const db = x18PosToDb(i / 1000);
      expect(db).toBeGreaterThan(prev);
      prev = db;
    }
  });

  it('clamps out-of-range and non-finite positions', () => {
    expect(x18PosToDb(2)).toBeCloseTo(10, 6);
    expect(x18PosToDb(-1)).toBe(-Infinity);
    expect(x18PosToDb(NaN)).toBe(-Infinity);
  });
});

describe('x18DbToPos', () => {
  it('inverts x18PosToDb across the travel', () => {
    for (let i = 1; i <= 1000; i++) {
      const pos = i / 1000;
      expect(x18DbToPos(x18PosToDb(pos))).toBeCloseTo(pos, 9);
    }
  });

  it('saturates outside the law', () => {
    expect(x18DbToPos(99)).toBe(1);
    expect(x18DbToPos(-90)).toBe(0);
    expect(x18DbToPos(-1000)).toBe(0);
    expect(x18DbToPos(-Infinity)).toBe(0);
    expect(x18DbToPos(Infinity)).toBe(1);
    expect(x18DbToPos(NaN)).toBe(0);
  });
});

describe('clampPos', () => {
  it('keeps every position inside what the console accepts', () => {
    for (const bad of [NaN, Infinity, -Infinity, -0.5, 1.5]) {
      const p = clampPos(bad as number);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    expect(clampPos(0.3)).toBe(0.3);
  });
});

describe('x18PosToPercent', () => {
  it('produces the 0..100 the REST endpoint takes', () => {
    expect(x18PosToPercent(0)).toBe(0);
    expect(x18PosToPercent(1)).toBe(100);
    expect(x18PosToPercent(X18_UNITY_POS)).toBe(75);
    expect(x18PosToPercent(0.12345)).toBe(12.3);
  });
});

describe('formatX18Db', () => {
  it('reads like the console does', () => {
    expect(formatX18Db(0)).toBe('0.0');
    expect(formatX18Db(-0)).toBe('0.0');
    expect(formatX18Db(3.25)).toBe('+3.3');
    expect(formatX18Db(-12.5)).toBe('−12.5');   // typographic minus
    expect(formatX18Db(-Infinity)).toBe('−∞');
  });

  it('never prints "-0.0"', () => {
    expect(formatX18Db(-0.04)).toBe('0.0');
  });
});

describe('spokenX18Db', () => {
  it('stays ASCII so a screen reader says something sensible', () => {
    expect(spokenX18Db(-12.5)).toBe('-12.5 dB');
    expect(spokenX18Db(0)).toBe('0 dB');
    expect(spokenX18Db(-Infinity)).toBe('minus infinity dB');
  });
});

describe('stepPosByDb', () => {
  it('steps in dB, not in fader travel', () => {
    expect(x18PosToDb(stepPosByDb(X18_UNITY_POS, 0.5))).toBeCloseTo(0.5, 6);
    expect(x18PosToDb(stepPosByDb(X18_UNITY_POS, -0.5))).toBeCloseTo(-0.5, 6);
  });

  it('lifts a closed fader off the bottom instead of staying at -infinity', () => {
    const up = stepPosByDb(0, 0.5);
    expect(up).toBeGreaterThan(0);
    expect(x18PosToDb(up)).toBeCloseTo(-89.5, 6);
  });

  it('closes the fader once the step reaches the bottom of the law', () => {
    expect(stepPosByDb(x18DbToPos(-89.8), -0.5)).toBe(0);
    expect(stepPosByDb(0, -0.5)).toBe(0);
  });

  it('never leaves the travel', () => {
    expect(stepPosByDb(1, 5)).toBe(1);
    expect(stepPosByDb(0.999, 100)).toBe(1);
  });
});

describe('strips', () => {
  it('covers the desk an X18/XR18 actually has', () => {
    expect(X18_CHANNEL_STRIPS).toHaveLength(16);
    expect(X18_BUS_STRIPS).toHaveLength(6);
    expect(X18_MASTER_STRIP.kind).toBe('master');
    expect(X18_MASTER_STRIP.index).toBeUndefined();
  });

  it('uses 1-based indices, which is what the OSC address wants', () => {
    expect(X18_CHANNEL_STRIPS[0]).toMatchObject({ kind: 'channel', index: 1, short: 'CH 1' });
    expect(X18_CHANNEL_STRIPS[15]).toMatchObject({ kind: 'channel', index: 16, short: 'CH 16' });
    expect(X18_BUS_STRIPS[5]).toMatchObject({ kind: 'bus', index: 6, short: 'BUS 6' });
  });

  it('gives every strip a unique, stable state key', () => {
    const all = [X18_MASTER_STRIP, ...X18_CHANNEL_STRIPS, ...X18_BUS_STRIPS];
    expect(new Set(all.map(s => s.id)).size).toBe(all.length);
    expect(x18StripId('channel', 4)).toBe('channel:4');
    expect(x18StripId('bus', 2)).toBe('bus:2');
    expect(x18StripId('master')).toBe('master');
  });

  it('resolves each scope to its own strips', () => {
    expect(x18StripsForScope('channels')).toBe(X18_CHANNEL_STRIPS);
    expect(x18StripsForScope('buses')).toBe(X18_BUS_STRIPS);
    expect(x18StripsForScope('master')).toEqual([X18_MASTER_STRIP]);
  });
});

describe('dragSensitivity', () => {
  it('is full speed on-axis and finer the further the finger strays', () => {
    expect(dragSensitivity(0)).toBe(1);
    expect(dragSensitivity(20)).toBe(1);
    expect(dragSensitivity(60)).toBe(0.4);
    expect(dragSensitivity(120)).toBe(0.15);
    expect(dragSensitivity(400)).toBe(0.05);
  });

  it('does not care which way the finger strayed', () => {
    for (const d of [10, 60, 120, 400]) {
      expect(dragSensitivity(-d)).toBe(dragSensitivity(d));
    }
  });

  it('never speeds a drag up', () => {
    for (let d = 0; d < 500; d += 7) expect(dragSensitivity(d)).toBeLessThanOrEqual(1);
  });
});
