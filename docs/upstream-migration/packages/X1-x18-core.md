# X1 — Behringer X-Air (X18/XR18) link and per-cue console actions

| | |
|---|---|
| Upstream PR title | `feat: drive a Behringer X-Air console from cues (OSC), with a two-way link to the desk` |
| Branch (in the fork) | `up/X1-x18-core` |
| Base | upstream target branch |
| Depends on | nothing. A1 is recommended first if the X18 is also the USB audio interface, so outputs above 1/2 work. |
| Size | ~1,700 lines: server ~1,250 (`osc_client` 313, `x18_addresses` 150, `x18_fader_law` 80, `x18_link` 478, `project_state` ~250, `control_server` ~70) + client ~300 + tests ~430 + catalog |
| Fork sources | `a248d0f`, `d73afbd` (server half + per-cue UI), `225dd72`, `374263e`, `f8d9c4a`, `c1ec7aa`, `99544b9` (relative moves), `bc7ac36` (server half: mute addresses) |
| Risk | Low to medium. It is opt-in: with no console IP nothing is sent and no socket is opened. **Ask the maintainer first** (master plan §4); it is hardware-specific. |

## What it does (fork behaviour to keep)

- Per cue (audio item), the operator lists **X18 actions** that fire when the
  cue **starts**, when it is **stopped**, or when it **ends** naturally:
  - set a fader (Main LR / a bus master / a channel's send in a mix) to a level;
  - set a mute;
  - set a mute group.
- `POST /api/x18/action` fires one command on demand. The board (X2) uses this.
- One process-wide `X18Link`: a single UDP socket on a stable source port
  (the desk replies to it), an `/xremote` subscription refreshed in the
  background, a sweep of the watched addresses, and a cache of current
  levels and mutes. `GET /api/x18/state` returns the cache. A
  `doc_patch {op:"x18_state"}` pushes changes to every client. Relative moves
  ("+3 dB") read the cached level, using the desk's own fader law.

## Persistence (decided)

| Data | Where | Why |
|---|---|---|
| `settings.x18Ip` (string) | project settings, **registered** in the settings registry as `StringOrNull` | Keeps every existing fork show loading unchanged, and is the minimum code. Upstream's server config has no live-apply settings (all `Applies::Restart`), so moving it there would also mean a restart to change desks. In the PR, mention that the ownership model would put venue hardware on the server, and offer to move it. |
| item `x18Actions` (array) | on the item, like `startBehavior` | Items are stored as JSON without a full schema, and the client sends them through unchanged (`itemsToJSON = _deepToRaw`) |

## Server steps

1. Copy verbatim from the fork:
   - `server/include/liveplay/net/osc_client.hpp`, `server/src/net/osc_client.cpp`
   - `server/include/liveplay/net/x18_addresses.hpp`
   - `server/include/liveplay/net/x18_fader_law.hpp`
   - `server/include/liveplay/net/x18_link.hpp`, `server/src/net/x18_link.cpp`

   Translate any remaining German comments or log strings. These files have not
   changed since `bc7ac36`; they are self-contained.
2. `server/CMakeLists.txt`: add `src/net/osc_client.cpp` and
   `src/net/x18_link.cpp` to the server sources, next to the other
   `src/net/*.cpp`. On Windows, check the socket library is linked (`ws2_32`;
   upstream already links it for discovery: `grep -n ws2_32 server/CMakeLists.txt`).
3. `server/src/core/project_state.cpp`:
   - `#include` the three net headers.
   - Register in `settings_registry()` under a new comment block
     `// --- External console (Behringer X-Air) ---`:
     `{"x18Ip", {SettingKind::StringOrNull}},`. X3 adds `x18Faders`.
   - Port the dispatch helpers from the fork (`origin/main` project_state.cpp
     ~L4731-4887: `x18_strip_address`, `x18_parse_mix`, `x18_dispatch_command`)
     into an anonymous namespace. Port `ProjectState::x18_console_ip()`,
     `x18_ip_locked_snapshot()`, `fire_x18_actions(uuid, trigger)`,
     `fire_x18_action(action)` (~L4889-4996), plus their declarations in
     `project_state.hpp` (fork L392-402, L587-597).
   - Hook points in upstream code:
     - `play_item()`: after the start-behaviour block (~L3316-3321), before
       `return true;`: `fire_x18_actions(uuid, "start");`
     - `stop_item()`: right after `engine_.stop(cue);` (~L3381):
       `fire_x18_actions(uuid, "stop");`
     - `handle_item_ended()` (~L8063): after `engine_.stop(item.cue_id);`:
       `fire_x18_actions(item.uuid, "stop");`

     Keep the fork's comments. **No other stop paths:** the fork did not fire on
     Stop All. Keep parity and mention it in the PR as a possible follow-up.
   - `fire_x18_actions` does network I/O. The fork calls it **without**
     `mutex_` held (it snapshots under the lock and sends after). Keep that.
4. `server/src/net/control_server.cpp` (fork ~L19, L388-420, L455-461, L2927-2960):
   - In the constructor or start (where upstream sets other handlers):
     `net::X18Link::instance().set_change_handler(...)` →
     `broadcast_doc_patch(json{{"op","x18_state"},{"values", values}})`. Use the
     fork's exact payload shape, because the client depends on it. Also
     `configure(state_.x18_console_ip())`.
   - On stop: `set_change_handler(nullptr)`.
   - In `broadcast_loop()`: the once-per-second
     `X18Link::instance().configure(state_.x18_console_ip())` re-aim (fork ~L455-461).
   - Routes `POST /api/x18/action` and `GET /api/x18/state`, in upstream's route
     style (`json_ok`/`json_err`, `Logger::api_request`). Upstream's auth
     middleware default-denies unknown routes to unauthenticated callers, which is
     correct (operator role). Do **not** add them to the admin list.
5. **API catalog** (`docs-site/public/api/reference.json`); otherwise
   `node docs-site/scripts/check-api-reference.mjs` fails:
   - two `endpoints` entries, copying the shape of `GET /api/master/gain`, with
     `category: "External console"`, `auth: "Operator"`, `apiToken: "Yes"`,
     request/response examples and `errors` rows;
   - one `websocket.patches` entry: `{ "op": "x18_state", "purpose": ..., "fields": [...], "example": {"type":"doc_patch","op":"x18_state","values":{...}}, "notes": ... }`;
   - `ProjectItem` schema: add an `x18Actions` field row (5 columns, as the
     others); project settings schema: add `x18Ip`.

## Client steps

1. `client/app/types/project.ts`: port `X18FaderTarget`, `X18Action`,
   `x18Actions?: X18Action[]` on audio and group items, and `x18Ip?: string`
   in settings. Add `x18Actions: []` to the item factories (fork L357/383/403).
2. `client/app/composables/useLiveplayServer.ts`: `x18Action(action)` and
   `x18State()` (fork ~L825-843), exported.
3. `client/app/components/PropertiesPanel.vue`: add an `x18` tab next to
   upstream's tabs (`basic`, `media`, `playback`, `output`, `ducking`,
   `endBehavior`, `startBehavior`), audio items only, single selection only.
   Port the panel body from the fork (`origin/main` PropertiesPanel ~L321-420)
   and its script helpers (`x18Actions`, `x18Configured`, `onX18KindChange`,
   `onX18TargetChange`, `removeX18Action`, add). Write through upstream's
   item-update path, the same one other fields in the panel use.
4. Settings: new `client/app/components/SettingsPaneX18.vue` with one field,
   "Console IP address", bound to project settings `x18Ip` through
   `useProjectSettings`. Copy the field markup pattern from
   `SettingsPanePlayback.vue`. Also show a link status line from `x18State()`
   if it is cheap. Register `{ id: 'x18', icon: 'tune', labelKey: 'settings.sectionX18' }`
   in `SETTINGS_SECTIONS` (`useSettingsPage.ts`, after `surfaces`) and in
   `SettingsPage.vue`'s `v-if` chain. Run `node client/tests/settings-form-placement-tests.js`.
5. Locales: the `x18.*` and `properties.x18*` keys this PR uses, plus
   `settings.sectionX18`, from fork `en.json`/`de.json`. Then
   `node scripts/sync-locale-keys.js`.

## Tests

Merge the fork's `server/tests/test_osc_client.cpp` (5 cases) and
`test_x18_link.cpp` (22 cases) into **one** framework-free
`server/tests/x18_test.cpp`. All of it is header-only (encoder/parser,
addresses, fader law); no sockets.

- Replace `#include <doctest/doctest.h>` with a local `check()` helper
  (see the master plan's conversion table).
- Make each `TEST_CASE("…")` a `static void test_…()` that prints its name.
  `main()` calls them all and returns `g_failures ? 1 : 0`.
- `server/CMakeLists.txt`, inside `if(LIVEPLAY_BUILD_TESTS)`, copying
  `liveplay-device-name-tests`:
  `add_executable(liveplay-x18-tests tests/x18_test.cpp)`, include dir
  `include/`, link `nlohmann_json::nlohmann_json` only if a header needs it,
  then `add_test(NAME x18 COMMAND liveplay-x18-tests)`.
- `docs/DEVELOPMENT.md`: "There are nine registered CTest suites" → ten, and add `x18`.

## Verification

- `ctest` (now with x18) green. `node docs-site/scripts/check-api-reference.mjs` green.
  `npm run build:client` green.
- Without a console: a project with no `x18Ip` produces no X18 log lines and no
  UDP socket (`lsof -i UDP` shows nothing new).
- With an X18 (or XR18) on the LAN: set the IP, give a cue a start action
  "Main LR fader to −10 dB" and a stop action "mute bus 1". Play: the desk moves.
  Stop: bus 1 mutes. A natural end also fires the stop action.
- Move a fader on the desk: `GET /api/x18/state` reflects it within ~1 s, and
  clients receive `x18_state`.
- Open an existing fork project: its `x18Ip` and cue actions are still there.

## Done when

- [ ] Server, client, catalog, tests and docs in one PR, split into commits
      (server link; hooks + routes; client; tests + catalog).
