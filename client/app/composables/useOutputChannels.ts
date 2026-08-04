import { useLiveplayServer } from '~/composables/useLiveplayServer';
import {
  channelOptions,
  parseChannel,
  parseChannelPair,
  withChannel,
  type OutputChannelOption,
} from '~/utils/outputChannels';

// Reactive wrapper around ~/utils/outputChannels: resolves how many hardware
// output channels a device has from the live server device list, and re-exports
// the pure helpers so components need only one import. See the utils module for
// the storage convention (0-based indices, 1-based labels).
export const useOutputChannels = () => {
  const server = useLiveplayServer();

  // Hardware output channels the server reports for a device, or 0 when the
  // device isn't in the list (project saved on another machine, interface
  // unplugged). Devices are keyed by name — the server's DeviceId *is* the
  // device name, which is also what the settings store.
  const channelCount = (deviceName: string): number => {
    if (!deviceName) return 0;
    const d = (server.devices ?? []).find(
      x => x.display_name === deviceName || x.id === deviceName);
    return d?.channel_count ?? 0;
  };

  // Options for a device's channel dropdown. `keep` channels stay selectable
  // even if the device currently reports fewer.
  const options = (deviceName: string, ...keep: number[]): OutputChannelOption[] =>
    channelOptions(channelCount(deviceName), ...keep);

  return {
    channelCount,
    options,
    pair:   parseChannelPair,
    single: parseChannel,
    withChannel,
  };
};
