import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OUTPUT_CHANNELS,
  channelOptions,
  parseChannel,
  parseChannelPair,
  withChannel,
} from '../app/utils/outputChannels';

// These rules mirror the server's parser in
// server/include/liveplay/core/output_channels.hpp — the two must agree, because
// either side may be the one reading a given project document.

describe('parseChannelPair', () => {
  it('takes a well-formed pair verbatim', () => {
    expect(parseChannelPair([4, 5])).toEqual([4, 5]);
    expect(parseChannelPair([0, 1])).toEqual([0, 1]);
  });

  it('keeps a single channel twice (mono) intact', () => {
    expect(parseChannelPair([6, 6])).toEqual([6, 6]);
  });

  it('falls back to the historical stereo pair for anything unusable', () => {
    // Every one of these is a shape an older or hand-edited project could hold.
    // None may yield a channel index we then route audio into.
    for (const bad of [
      undefined, null, 3, '4,5', {}, [], [4], [4, 5, 6],
      [-1, 2], [2, -1], ['4', '5'], [4, null], [1.5, 2], [NaN, 1],
    ]) {
      expect(parseChannelPair(bad)).toEqual(DEFAULT_OUTPUT_CHANNELS);
    }
  });

  it('returns a fresh array so callers cannot mutate the default', () => {
    const a = parseChannelPair(undefined);
    a[0] = 9;
    expect(parseChannelPair(undefined)).toEqual([0, 1]);
    expect(DEFAULT_OUTPUT_CHANNELS).toEqual([0, 1]);
  });
});

describe('parseChannel', () => {
  it('accepts usable indices', () => {
    expect(parseChannel(0)).toBe(0);
    expect(parseChannel(17)).toBe(17);
  });

  it('falls back for anything unusable', () => {
    expect(parseChannel(undefined)).toBe(0);
    expect(parseChannel(null)).toBe(0);
    expect(parseChannel(-1)).toBe(0);
    expect(parseChannel('2')).toBe(0);
    expect(parseChannel(2.5)).toBe(0);
    expect(parseChannel(undefined, 7)).toBe(7);
  });
});

describe('channelOptions', () => {
  it('labels 0-based values 1-based, the way outputs are printed on the box', () => {
    expect(channelOptions(4)).toEqual([
      { value: 0, label: '1' },
      { value: 1, label: '2' },
      { value: 2, label: '3' },
      { value: 3, label: '4' },
    ]);
  });

  it('covers every channel of an 18-out interface', () => {
    const opts = channelOptions(18);
    expect(opts).toHaveLength(18);
    expect(opts[17]).toEqual({ value: 17, label: '18' });
  });

  it('offers a stereo pair even for an unknown or mono device', () => {
    // 0 = device not in the list; 1 = a mono device. Either way the operator
    // must still be able to express a left/right pair.
    expect(channelOptions(0)).toHaveLength(2);
    expect(channelOptions(1)).toHaveLength(2);
  });

  it('keeps a stored selection selectable beyond the reported count', () => {
    // Project saved against an 18-out interface, reopened while the device
    // reports only 2 — channel 12 must not vanish from the list.
    const opts = channelOptions(2, 11);
    expect(opts).toHaveLength(12);
    expect(opts.at(-1)).toEqual({ value: 11, label: '12' });
  });

  it('ignores unusable keep values', () => {
    expect(channelOptions(2, NaN, -3, 1.5)).toHaveLength(2);
  });
});

describe('withChannel', () => {
  it('replaces one side and leaves the other alone', () => {
    expect(withChannel([0, 1], 0, 4)).toEqual([4, 1]);
    expect(withChannel([0, 1], 1, 5)).toEqual([0, 5]);
  });

  it('does not mutate the input', () => {
    const current: [number, number] = [0, 1];
    withChannel(current, 0, 9);
    expect(current).toEqual([0, 1]);
  });
});
