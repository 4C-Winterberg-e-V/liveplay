# M2 — Touch controls: Pointer Events, one-line cue rows, safe cart pads, deferred seek

| | |
|---|---|
| Upstream PR title | `feat(client): make faders, trimming, seeking, reordering and cart pads work by touch` |
| Branch (in the fork) | `up/M2-touch-controls`, stacked on `up/M1-phone-layout` |
| Depends on | **M1** (tokens, `useCompactLayout`) |
| Size | ~800-1,100 lines |
| Fork sources | the touch parts of `babaab9`, `6803d5d`, `c06f122` (seek scoped to the pressing pointer), `f18eaa6` (hover must not swallow a pad click), `d176dcc` (confirm-tap before a pad fires on touch), `72dd5fb` (touch cart slots), `e520cac`, `f64211e` |
| Risk | Medium. These controls are on the audio path, so test with real audio. |

## Why

Upstream's older controls only use `mousedown` + window `mousemove`. On a
phone the output faders, the in/out trimmer and cue reordering are
inoperable. Upstream's **new** components already use Pointer Events
(`MixerPanel`, `MixerStrip`, `MixerEqPanel`, the `MainWorkspace` splitters), so
leave those alone.

## Rules (from the fork; keep them)

- Pointer Events with `setPointerCapture`, handle `pointercancel`, and track the
  **pointer id** that started the gesture (`c06f122`). A second finger must not
  move the first finger's control.
- **Anything audible is gated on `isCoarse`**, never on width (see M1 spec #1).
- Seek is a **deferred-commit scrub** on touch: a stationary tap does not jump a
  live cue, and the seek commits on release. A desktop click still seeks on
  press, as upstream does today.
- Cart pads on touch: the first tap **arms** the pad, the second tap fires it
  (`d176dcc`). `onPadPointerMove` must be gated on `isCoarse`, like
  `onPadPointerDown` (`f18eaa6`). Otherwise a hovering mouse swallows the first
  click in Show Mode.
- A vertical swipe over a list scrolls. A >10px move cancels a pending tap or long-press.

## Steps (one commit per component group)

For each component: open the fork's final file (`git show origin/main:client/app/components/<X>.vue`)
next to upstream's. Port the pointer handlers and the compact CSS. **Do not
copy whole files.**

1. `CanvasFader.vue`: replace mouse handlers with pointer handlers (fork +40/-10).
2. `WaveformTrimmer.vue`: in/out handle dragging plus panel resize via pointer
   events (fork has 13 pointer bindings). Upstream changed this file heavily
   (+307/-98), so map the handles by their role (in-point, out-point, volume).
3. `PlaylistItem.vue`: one-line 56px compact row with a labelled PLAY/STOP button
   (compact CSS). Long-press for multi-select. Reorder via `moveItemBy` on
   touch. Upstream `useProject.ts` has **no** `moveItemBy`. Port it from the
   fork's `useProject.ts` (`git show origin/main:client/app/composables/useProject.ts`,
   search `moveItemBy`) and export it. It must go through upstream's normal
   item-change path so `syncItemsDiff` sends a reorder. Set-as-next stays
   reachable in Show Mode (`f64211e`). Delete and set-as-next move out of the
   row into the properties sheet on compact.
4. `ActiveCueItem.vue` + `PlaybackControls.vue`: stacked running cues that keep
   their name, remaining time and level on compact. Deferred-commit seek scrub
   scoped to the pressing pointer (`c06f122`).
5. `CartSlot.vue` + `CartPlayer.vue`: touch pads with arm-then-fire, the
   `isCoarse` gates, and the compact grid. Empty-pad hiding fails open (`babaab9`
   "Known limitations"). Upstream's CartSlot changed (+106/-63, groups in cart
   slots), so keep group behaviour intact.
6. `VolumeSlider.vue`, `Btn.vue`, `ActionButton.vue`: compact sizing only.
7. Run `npm run lp:bp-check`.

## Verification

- A Playwright touch emulation (`hasTouch: true, isMobile: true`) or a real phone:
  - drag a fader; drag in/out points; scrub a running cue (it commits on release
    only); reorder two cues; long-press to multi-select;
  - cart pad: one tap arms it (visual state), a second tap plays; a scroll
    swipe across pads plays nothing.
- Desktop with a mouse: everything behaves exactly as before, including the
  cart pad's first click in Show Mode (the `f18eaa6` regression).
- Two simultaneous cues on a phone: both cards show their names.

## Done when

- [ ] All six groups done. Desktop unchanged. Touch test list passes on a real phone.
