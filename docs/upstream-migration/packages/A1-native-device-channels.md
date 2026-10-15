# A1 — Open output devices with their native channel count

| | |
|---|---|
| Upstream PR title | `fix(audio): open output devices with their native channel count, so outputs above 1/2 are reachable` |
| Branch (in the fork) | `up/A1-native-device-channels` |
| Base | upstream target branch |
| Depends on | nothing |
| Size | ~60-100 lines in `engine.cpp` / `engine.hpp` / `project_state.cpp` + 1 e2e assertion |
| Fork source | `4555683` (only the "devices were opened with a hardcoded 2 channels" part) |
| Risk | Medium. It changes how every output device is opened. Test on macOS, Windows and Linux, and on a stereo-only device. |

## What this replaces from the fork

The fork's feature "select which hardware output channels a cue plays out of"
(`4555683`) had two parts:

1. **A data model and UI**: channel pairs on `defaultOutputChannels`,
   `previewChannels`, `ltcChannel` and per-item `deviceOverrideChannels`.
   **This is superseded upstream and must NOT be ported.** Upstream routes
   *item → bus → logical output → (device, hw_channel list)*. The mapping lives
   in the server's `outputs.json` and is edited in *Settings → Outputs*
   (`SettingsPaneOutputs.vue`). "Play this cue on X18 USB 5/6" means: map a
   logical output (e.g. `X18 5-6`) to device X18, channels 4 and 5 (0-based),
   point a bus at it, and assign the cue or its group to that bus.
2. **Engine fixes**. Upstream fixed two of the three independently:
   - "Main" mixer picked arbitrarily: fixed upstream (`ensure_default_routing`
     prefers the registered master strip or a strip named Main).
   - Cue not unrouted from Main: fixed upstream (`route_cue_to_mixer` calls
     `engine_.unroute_item_from_all_mixers`).
   - **Devices opened with a hardcoded 2 channels: still broken upstream.
     That is this PR.**

## The bug in upstream v2.5.1

- Every routing path opens the device as stereo:
  - `ProjectState::ensure_ltc_routing` (~L1838)
  - `trigger_item` (~L4011)
  - `wire_bus` (~L5476)
  - `wire_preview_bus` (~L5598)
  - `AudioEngine::ensure_default_routing` (`open_default_device(2)`, `engine.cpp` ~L811)

  All of them call `open_device_by_name(name, 2)`.
- The render loop drops any master aimed past the device's channel count:
  `if (dest->hw_channel >= dev->channels) continue;` (`engine.cpp` ~L2088). So a
  logical output mapped to an 18-out interface's channels 5/6 is **silent**,
  although Settings → Outputs offers those channels.
- Opening an 18-channel interface (X18/XR18, X32 card, Dante) as 2 channels
  makes miniaudio insert a channel converter that **upmixes** the stereo pair
  across the device's speaker layout. The fork measured this on a real X18:
  a stereo cue leaked onto outputs 1, 2, 3, 5, 6, 7 and 8 at various gains.

## Steps

1. **Check the miniaudio contract** in the vcpkg-installed `miniaudio.h`
   (`find "$VCPKG_ROOT" -name miniaudio.h`). Confirm that
   `ma_device_config.playback.channels = 0` means "use the device's native
   channel count", and that after `ma_device_init` the actual count is in
   `device.playback.channels`. If that does not hold for the installed version,
   use the fork's approach instead: read `nativeDataFormats[0].channels` for the
   matched device via `ma_context_get_device_info`, as `enumerate_devices()`
   already does at `engine.cpp` ~L355-363.
2. In `server/include/liveplay/audio/engine.hpp`, add next to the
   `open_device_by_name` declaration:
   ```cpp
   // Pass as output_channels to open a device with every channel it has.
   // Opening a multi-output interface as stereo makes miniaudio upmix the pair
   // across its outputs and leaves channels >= 2 unreachable.
   inline constexpr ChannelCount kNativeChannels = 0;
   ```
3. In `AudioEngine::open_device_by_name` (`engine.cpp` ~L437):
   - Share-cache check: treat a native request as matching any open handle of
     that device. Change it to
     `d->display_name == want && (output_channels == kNativeChannels || d->channels == output_channels)`.
   - Set `cfg.playback.channels = output_channels;` as before. Zero now means
     native.
   - After a successful `ma_device_init`, set
     `dev->channels = dev->ma_dev->playback.channels;` and use `dev->channels`
     everywhere below that previously used `output_channels`, especially
     `ma_pcm_rb_init(ma_format_f32, ..., ring_frames, ...)` and any scratch
     buffer sizing. Search the rest of the function for `output_channels`.
   - If `ma_device_init` fails **and** the request was native, log a warning and
     retry once with `cfg.playback.channels = 2`, as fork `4555683` did in
     `ensure_default_routing`.
   - Log once per opened device: `Logger::info("Opened '{}' with {} output channels", ...)`.
4. Replace the literal `2` with `audio::kNativeChannels` in the five call sites
   listed above (`project_state.cpp` ×4, `engine.cpp` `ensure_default_routing` ×1).
   Do **not** change `control_server.cpp` ~L3058. That is the explicit
   `POST /api/devices` endpoint, where the caller chooses the count.
5. Look for other code that assumes a device has 2 channels, e.g. meter or
   underrun bookkeeping using `2 *`. Run `grep -n "channels" server/src/audio/engine.cpp`
   and fix anything that sizes per-device buffers from a constant.

## Tests

- **Unit:** none. This is backend behaviour.
- **e2e:** upstream already has `output-materialise-e2e.js` and
  `device-match-e2e.js`, both of which skip without a device. Add one
  assertion to `output-materialise-e2e.js`, or a new
  `native-channels-e2e.js <port>`: `GET /api/devices` (or the endpoint
  `SettingsPaneOutputs.vue` uses to list devices) and, for the default device,
  check that the opened channel count equals the reported native count. Use
  whatever existing endpoint exposes open devices; if none exposes it, skip the
  e2e and rely on the manual test.
- **Manual (required, from the fork's original verification):** with a
  multi-output USB interface (X18/XR18):
  1. In Settings → Outputs, map `X18 5-6` → X18 channels 5 and 6 (UI is 1-based).
  2. Create a bus targeting `X18 5-6` and assign a cue to it.
  3. Play the cue. Signal appears **only** on USB returns 5/6 on the desk, with
     nothing on 1/2/3/7/8.
  4. Stop and play again: still 5/6.
  5. With a plain stereo device (laptop speakers), playback is unchanged.

## PR description outline

Explain the silent channels ≥3 and the upmix leak with the X18 measurement.
Show the one-line render-loop drop and the five call sites. Note that the
logical output map already models channels and this makes them audible.
Include the platform matrix that was tested.

## Done when

- [ ] Five call sites switched. Ring and scratch buffers sized from the opened count.
- [ ] Manual X18 test passes on at least macOS. Plain stereo device unchanged on Windows.
- [ ] `ctest` and `busbus-e2e`, `roles-e2e`, `output-materialise-e2e` still green.
