# U1 — Small UX fixes that are not phone-specific

| | |
|---|---|
| Upstream PR title | `fix(client): Stop All always armed, in-app delete confirmation, per-device Show Mode option, resume prompt, vertical slider` |
| Branch (in the fork) | `up/U1-ux-papercuts` |
| Base | upstream target branch |
| Depends on | nothing. M1 uses item 3. |
| Size | ~150 lines + a few locale keys |
| Fork sources | parts of `babaab9` (Stop All, delete dialog), `a307503` (Show Mode, **redesigned**), `67e566d` (resume prompt), `3e2d77b` (slider-vertical) |
| Risk | Low. Item 3 is opt-in. Items 1, 2 and 4 change default behaviour slightly, so say so in the PR. |

One commit per item. If the maintainer objects to one, drop that commit only.

## 1. `fix(client): Stop All is never disabled`

Upstream `PlaybackControls.vue` L17 has
`:disabled="activeCues.size === 0 && !previewingItem"` on the panic button.
`stopAll` is idempotent, and a control that is greyed out for most of a show
never becomes muscle memory. Remove the `:disabled` binding and keep the
tooltip. If upstream styles `.panic-btn:disabled`, remove that rule as well.
Fork reference: `babaab9` ("Safety" paragraph of its message).

## 2. `fix(client): confirm single deletes in the app, not with window.confirm()`

`window.confirm()` blocks the renderer, freezing meters and transport, behind
an OS modal. Upstream uses it for a single item:
`PlaylistItem.vue` ~L673-674:
`if (requestDeleteFromButton(props.item.uuid)) return; if (confirm(...)) {...}`.
CartSlot ~L539 has the same pattern.

- In `useProject.ts`, make `requestDeleteFromButton(uuid, context)` handle the
  single-item case through the same in-app confirmation it already uses for a
  multi-selection, and always return `true`. The fork's version is at
  `origin/main` `client/app/composables/useProject.ts` ~L1248. Port its logic
  onto upstream's function. Don't paste the whole file.
- Remove the native `confirm(...)` fallbacks in `PlaylistItem.vue` and `CartSlot.vue`.
- Keyboard DEL (`requestDeleteFromKeyboard`) stays unchanged.

## 3. `feat(client): let a device keep its own Show Mode`

Upstream syncs Show Mode across all clients through the server
(`useShowControl.ts`: snapshot `show_mode`, `show_mode_changed`, and an outbound
`watch(uiMode)`). A phone switching to Show Mode therefore flips the editing
laptop too. The fork deleted the sync (`a307503`), which reverses an upstream
design decision: Companion's Show Mode button relies on it. **Do not port
`a307503` as it is.** Instead:

- Add a machine-tier preference, `localStorage['liveplay-follow-show-mode']`,
  default `true` (upstream behaviour). Put it in `useUiMode.ts`, next to
  `liveplay-ui-mode`.
- In `useShowControl.ts`, when it is `false`: ignore the inbound
  `show_mode` / `show_mode_changed`, and don't push local changes from the
  `watch(uiMode)`. Selection and locale sync stay untouched.
- UI: a switch "Follow Show Mode from other devices" in
  `SettingsPaneAppearance.vue`, or wherever upstream keeps Show Mode settings.
  i18n keys go in `en`/`de`, then run `sync-locale-keys.js`.
- Document it in `docs/OWNERSHIP_MODEL.md` "Machine state" table.

M1 turns this off by default on compact (phone) layouts.

## 4. `feat(client): offer to resume the open project instead of adopting it silently`

Upstream `WelcomeScreen.vue` ~L522 (Local mode) calls
`tryRejoinExistingProject()` and drops straight into whatever project the
detached server still has open. The fork (`67e566d`) shows the project picker
with a prominent "Continue with <name>" button instead, so the operator decides.

Port `resumableProject`, `peekResumableProject()`, `handleResume()` and the
button from the fork's `WelcomeScreen.vue` (`origin/main` ~L157-162, ~L264,
~L575-610) into upstream's local-mode branch. Reset the state in `changeMode`.
Add the locale key `welcome.continueProject` (`"Continue with {name}"` / de from
the fork). Remote and discovered-server rejoin stay unchanged.

## 5. `fix(client): drop the deprecated slider-vertical appearance`

`WaveformTrimmer.vue` `.volume-slider-vertical` (~L1599-1606) already sets
`writing-mode: vertical-lr; direction: rtl`. The deprecated
`-webkit-appearance: slider-vertical; appearance: slider-vertical;` is redundant
and triggers Chromium's deprecation warning. Remove the two lines and add the
fork's comment (`3e2d77b`).

## Verification

- Idle: Stop All is clickable and does nothing harmful.
- Delete one cue from its row button: an in-app dialog appears and meters keep moving.
- Two clients, with "follow" off on client B: toggling Show Mode on A leaves B
  alone, and B's toggle leaves A alone. With "follow" on (default), it behaves
  as before.
- Restart the app with the server still running a project: the picker shows
  "Continue with …". Clicking it rejoins.
- The volume slider in the waveform trimmer is still vertical, with no console warning.
