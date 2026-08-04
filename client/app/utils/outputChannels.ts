// Pure logic for picking which *hardware* output channels an output lands on:
// the project's main output, the preview output, the LTC output, and a per-cue
// device override. Kept free of Nuxt/Vue imports so it can be unit-tested
// directly — `useOutputChannels` is the thin reactive wrapper around it.
//
// Storage convention: the project document holds 0-based indices, because that
// is what the server's routing API takes (`hw_channel`). The operator sees them
// 1-based, the way outputs are labelled on the interface — an X18's USB return 1
// is hardware channel 0. The conversion lives in `channelOptions()` so no
// off-by-one arithmetic leaks into the components.

export interface OutputChannelOption {
  value: number;   // 0-based hardware channel index — what gets stored
  label: string;   // 1-based — what the operator reads
}

export type OutputChannelPair = [number, number];

// The stereo pair LivePlay wired unconditionally before channel selection
// existed. A project or cue with nothing stored keeps playing out of hardware
// channels 1/2, exactly as before.
export const DEFAULT_OUTPUT_CHANNELS: OutputChannelPair = [0, 1];

export const isChannelIndex = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;

// Read a stored `[left, right]` pair, tolerating anything an older or
// hand-edited project may hold. Mirrors the server's parser: unusable values
// mean "not configured", never a bogus channel index.
export function parseChannelPair(stored: unknown): OutputChannelPair {
  if (Array.isArray(stored) && stored.length === 2 && stored.every(isChannelIndex)) {
    return [stored[0] as number, stored[1] as number];
  }
  return [...DEFAULT_OUTPUT_CHANNELS];
}

// Read a stored single channel (the mono LTC output).
export function parseChannel(stored: unknown, fallback = 0): number {
  return isChannelIndex(stored) ? stored : fallback;
}

// Build the option list for a channel dropdown. `keep` lists channels that must
// stay selectable even when they're beyond `channelCount` — pass the stored
// selection so opening a project while the interface is in stereo mode doesn't
// silently drop the operator's choice from the list.
export function channelOptions(channelCount: number, ...keep: number[]): OutputChannelOption[] {
  const highest = Math.max(
    (Number.isFinite(channelCount) ? channelCount : 0) - 1,
    ...keep.filter(isChannelIndex),
    1,                                   // always offer at least a stereo pair
  );
  const out: OutputChannelOption[] = [];
  for (let i = 0; i <= highest; i++) out.push({ value: i, label: String(i + 1) });
  return out;
}

// Replace one half of a pair, leaving the other alone.
export function withChannel(
  current: OutputChannelPair,
  side: 0 | 1,
  channel: number,
): OutputChannelPair {
  const next: OutputChannelPair = [...current];
  next[side] = channel;
  return next;
}
