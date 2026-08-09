import { describe, it, expect } from 'vitest';
import {
  X18_UNITY_POS,
  clampPos,
  dragSensitivity,
  formatX18Db,
  isSameX18Target,
  isValidX18Entry,
  stepPosByDb,
  x18ChannelMixAddress,
  x18ChannelMixMuteAddress,
  x18DbToPos,
  x18EntryAddress,
  x18EntryMuteAddress,
  x18EntryTag,
  x18MixAddress,
  x18MixLabel,
  x18MixMuteAddress,
  x18MutedToOn,
  x18OnToMuted,
  x18PosToDb,
  x18PosToPercent,
  type X18FaderEntry,
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

// These addresses MUST match the server's builders in
// server/include/liveplay/net/x18_addresses.hpp byte for byte: the server keys
// its cache of console values by address and the client looks levels up by the
// same key, so a mismatch is a permanently blank fader with no error anywhere.
// server/tests/test_x18_link.cpp asserts the same literals from the other side.
describe('x18ChannelMixAddress', () => {
  it('matches the published X-Air addresses', () => {
    expect(x18ChannelMixAddress(1, 'lr')).toBe('/ch/01/mix/fader');
    expect(x18ChannelMixAddress(16, 'lr')).toBe('/ch/16/mix/fader');
    expect(x18ChannelMixAddress(1, 1)).toBe('/ch/01/mix/01/level');
    expect(x18ChannelMixAddress(3, 2)).toBe('/ch/03/mix/02/level');
    expect(x18ChannelMixAddress(16, 6)).toBe('/ch/16/mix/06/level');
  });

  it('returns empty for anything off the desk rather than clamping', () => {
    // Clamping would send a real level to a real speaker nobody asked for.
    for (const bad of [0, 17, -1, 1.5, NaN]) {
      expect(x18ChannelMixAddress(bad as number, 1)).toBe('');
    }
    expect(x18ChannelMixAddress(1, 7)).toBe('');
    expect(x18ChannelMixAddress(1, 0)).toBe('');
    expect(x18ChannelMixAddress(1, 'fx' as any)).toBe('');
  });
});

describe('x18MixAddress', () => {
  it("uses the console's own inconsistent padding", () => {
    expect(x18MixAddress('lr')).toBe('/lr/mix/fader');
    expect(x18MixAddress(1)).toBe('/bus/1/mix/fader');
    expect(x18MixAddress(6)).toBe('/bus/6/mix/fader');
  });

  it('rejects buses the desk does not have', () => {
    for (const bad of [0, 7, -1, 2.5, NaN]) expect(x18MixAddress(bad as number)).toBe('');
  });
});

// Mute addresses must agree with server/include/liveplay/net/x18_addresses.hpp
// byte for byte, exactly as the level addresses do — the server caches console
// values under these strings and the client looks them up under the same ones.
// tests/test_x18_link.cpp asserts the identical literals.
describe('mute addresses', () => {
  it('is the on/off switch beside the level, with the same padding rules', () => {
    expect(x18MixMuteAddress('lr')).toBe('/lr/mix/on');
    expect(x18MixMuteAddress(1)).toBe('/bus/1/mix/on');
    expect(x18MixMuteAddress(6)).toBe('/bus/6/mix/on');
    expect(x18ChannelMixMuteAddress(1, 'lr')).toBe('/ch/01/mix/on');
    expect(x18ChannelMixMuteAddress(16, 'lr')).toBe('/ch/16/mix/on');
    expect(x18ChannelMixMuteAddress(3, 2)).toBe('/ch/03/mix/02/on');
    expect(x18ChannelMixMuteAddress(16, 6)).toBe('/ch/16/mix/06/on');
  });

  it('rejects anything the desk does not have', () => {
    for (const bad of [0, 7, -1, 2.5, NaN]) {
      expect(x18MixMuteAddress(bad as number)).toBe('');
      expect(x18ChannelMixMuteAddress(1, bad as number)).toBe('');
    }
    for (const bad of [0, 17, -1, 1.5, NaN]) {
      expect(x18ChannelMixMuteAddress(bad as number, 1)).toBe('');
    }
  });

  it('never collides with the level address it sits beside', () => {
    expect(x18ChannelMixMuteAddress(3, 2)).not.toBe(x18ChannelMixAddress(3, 2));
    expect(x18MixMuteAddress(2)).not.toBe(x18MixAddress(2));
  });
});

// The console's value is 1 for AUDIBLE and 0 for MUTED — the opposite of the
// word. Inverting this by accident silences a live channel instead of restoring
// it, so the round trip is pinned here rather than trusted to a reading.
describe('mute value sense', () => {
  it('reads 0 as muted and 1 as audible', () => {
    expect(x18OnToMuted(0)).toBe(true);
    expect(x18OnToMuted(1)).toBe(false);
  });

  it('writes muted as 0 and audible as 1', () => {
    expect(x18MutedToOn(true)).toBe(0);
    expect(x18MutedToOn(false)).toBe(1);
  });

  it('round-trips both ways', () => {
    for (const muted of [true, false]) {
      expect(x18OnToMuted(x18MutedToOn(muted))).toBe(muted);
    }
  });
});

describe('fader entries', () => {
  const mix = (bus: any): X18FaderEntry => ({ id: 'a', kind: 'mix', bus });
  const send = (channel: any, bus: any): X18FaderEntry => ({ id: 'b', kind: 'send', channel, bus });

  it('resolves to the address of the thing it names', () => {
    expect(x18EntryAddress(mix('lr'))).toBe('/lr/mix/fader');
    expect(x18EntryAddress(mix(3))).toBe('/bus/3/mix/fader');
    expect(x18EntryAddress(send(3, 'lr'))).toBe('/ch/03/mix/fader');
    expect(x18EntryAddress(send(3, 2))).toBe('/ch/03/mix/02/level');
  });

  it('resolves to nothing when it names nothing real', () => {
    expect(x18EntryAddress(send(99, 1))).toBe('');
    expect(x18EntryAddress(mix(9))).toBe('');
    expect(x18EntryAddress({ id: 'c', kind: 'send', bus: 1 } as X18FaderEntry)).toBe('');
    expect(isValidX18Entry(send(99, 1))).toBe(false);
    expect(isValidX18Entry(send(1, 1))).toBe(true);
  });

  it('resolves to the mute switch beside that same thing', () => {
    expect(x18EntryMuteAddress(mix('lr'))).toBe('/lr/mix/on');
    expect(x18EntryMuteAddress(mix(3))).toBe('/bus/3/mix/on');
    expect(x18EntryMuteAddress(send(3, 'lr'))).toBe('/ch/03/mix/on');
    expect(x18EntryMuteAddress(send(3, 2))).toBe('/ch/03/mix/02/on');
    // An entry that names nothing must not produce a mute address either —
    // otherwise an invalid strip gets a working mute button pointed at a
    // channel it was never meant to reach.
    expect(x18EntryMuteAddress(send(99, 1))).toBe('');
    expect(x18EntryMuteAddress(mix(9))).toBe('');
  });

  it('labels the route in the desk\'s own terms', () => {
    expect(x18MixLabel('lr')).toBe('MAIN LR');
    expect(x18MixLabel(4)).toBe('BUS 4');
    expect(x18EntryTag(mix('lr'))).toBe('MAIN LR');
    expect(x18EntryTag(mix(2))).toBe('BUS 2');
    expect(x18EntryTag(send(3, 2))).toBe('CH 3 \u2192 BUS 2');
    expect(x18EntryTag(send(3, 'lr'))).toBe('CH 3 \u2192 MAIN LR');
  });

  it('spots two entries driving the same console parameter', () => {
    expect(isSameX18Target(send(3, 2), { ...send(3, 2), id: 'other' })).toBe(true);
    expect(isSameX18Target(send(3, 2), send(3, 1))).toBe(false);
    expect(isSameX18Target(send(3, 'lr'), mix('lr'))).toBe(false);
    // Two entries that both name nothing are not "the same target".
    expect(isSameX18Target(send(99, 1), send(98, 1))).toBe(false);
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
