# X3 — X18 levels page: faders you compose, kept in sync with the desk

| | |
|---|---|
| Upstream PR title | `feat(client): an X-Air levels page — your own faders and mutes, two-way with the console` |
| Branch (in the fork) | `up/X3-x18-levels`, stacked on `up/X2-x18-board` |
| Depends on | **X2** (the pane), **X1** (readback, `x18_state`) |
| Size | ~1,900 lines: `X18FaderStrip.vue` 889, `X18FaderEditor.vue` 377, `X18FaderPanel.vue` 258, `useX18Faders.ts` 336, `utils/x18Fader.ts` 227, registry kind ~40, tests ~300 |
| Fork sources | `64a3c71`, `6534dd1`, `50740d6`, `13959cf`, `b08a54f`, `77a2406`, `f6ec6dd`, `190c383`, `bc7ac36` (client half) |
| Risk | Low. It is UI on top of X1's link. |

## What it does

A **Levels** section in the X18 pane. The operator builds a list of faders,
each either a mix's own output (Main LR or bus 1-6) or **one channel inside one
mix** (e.g. "channel 3 in the stage monitor"). Each fader has a custom name and
a mute button beside it. Values are **read from the desk** (X1's link), so a
fader moved on the console moves on every client.

Touch behaviour is fork-specified: relative drag, so tapping does not jump; a
vertical swipe scrolls; going off-track or holding Shift gives fine mode; ±
buttons step 0.5 dB and accelerate; the dB display uses the desk's fader law.

## Persistence

`settings.x18Faders` (array of `X18FaderEntry`, see fork `types/project.ts`
~L166-200), kept in project settings so fork shows load unchanged. Upstream's
registry has no array kind, so add one following the `Ballistics` precedent:

- `SettingKind::X18Faders`: accept an array of at most 64 objects. Per entry,
  keep only the known fields with the right types (copy the shape from the TS
  interface: id string, kind enum, bus `"lr"` or 1-6, channel 1-16, name
  string ≤ 64 chars, and whatever else the interface declares). Drop invalid
  entries. Follow `Ballistics`' validation function for style.
- Register `{"x18Faders", {SettingKind::X18Faders}}` in the X18 block from X1.
- Add an e2e assertion to `server/tests/e2e/settings-registry-e2e.js` (no audio
  needed): PATCH a valid list and an invalid one; check what is stored.

## Steps

1. Copy verbatim from the fork: `components/X18FaderPanel.vue`,
   `X18FaderStrip.vue`, `X18FaderEditor.vue`, `composables/useX18Faders.ts`,
   `utils/x18Fader.ts`.
2. Restore the Levels section in `X18View.vue`: the `section` switch between
   `board` and `faders`, and `<X18FaderPanel v-if="section === 'faders'" />`
   (fork X18View L42-66).
3. `types/project.ts`: `X18FaderEntry` and `x18Faders?: X18FaderEntry[]` in settings.
4. **CSS tokens:** these components use the fork's touch tokens (`--lp-tap`,
   `--lp-tap-sm`, `--lp-tap-lg`, `--lp-tap-icon`, `--lp-input-fs-min`,
   `--lp-input-h`, `--lp-panel-header-h`, `--lp-sheet-top`, `--lp-bottom-h`).
   They are defined by M1. If M1 is **not** merged when this PR goes up, rewrite
   each use as `var(--lp-tap, 44px)`, `var(--lp-tap-sm, 40px)`,
   `var(--lp-tap-lg, 56px)`, `var(--lp-tap-icon, 24px)`,
   `var(--lp-input-fs-min, 16px)`, `var(--lp-input-h, 44px)`,
   `var(--lp-panel-header-h, 44px)`, `var(--lp-sheet-top, 52px)`,
   `var(--lp-bottom-h, 0px)`. Those are the fork's compact values. Then the
   page works without M1.
5. Locales: the levels' `x18.*` keys (en and de), then sync.

## Tests

Convert `client/test/x18Fader.test.ts` (Vitest) to `client/tests/x18-fader-tests.js`
with the transpile + vm pattern (see C1). Keep every case: fader-law round
trips, relative-drag maths, mute sense. List it under "Checks" in `docs/DEVELOPMENT.md`.

## Verification

- `node client/tests/x18-fader-tests.js` green. `settings-registry-e2e.js` green.
- With a desk: add "Ch 3 → Bus 1" and "Main LR". Drag on screen → the desk
  moves. Move the desk → the screen moves on two clients. The mute buttons
  round-trip.
- A phone (W1/W2): a vertical swipe scrolls the list without moving a fader,
  and ± accelerates when held.
