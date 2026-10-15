# X2 — X18 control board pane (programmable buttons with key bindings)

| | |
|---|---|
| Upstream PR title | `feat(client): an X-Air control board pane — buttons for faders, mutes and mute groups, with keyboard shortcuts` |
| Branch (in the fork) | `up/X2-x18-board`, stacked on `up/X1-x18-core` |
| Depends on | **X1** |
| Size | ~1,100 lines: `X18View.vue` (board part) ~550, `useX18Board.ts` 109, workspace pane wiring ~100, hotkeys ~20, server document key ~10, locales |
| Fork sources | `d73afbd` (board + mute groups), `225dd72` (edit mode doesn't send), `f0da125` (editor stays open), `374263e` (no IP → don't send), `99544b9` (relative "move BY" buttons), `61f4237` (X18 in the bar) |
| Risk | Low. A new pane that is off by default. |

## What it does

A grid of operator-defined buttons, each firing one X18 command (fader to a
level or **by** an amount, mute on/off/toggle, mute group). Each button can
have a keyboard shortcut. An edit mode adds, edits and removes buttons without
sending to the desk. The board is saved with the show as the top-level
document key `x18Board`.

## Steps

1. **Server persistence of `x18Board`** (`project_state.cpp`):
   - new-project default document (upstream `reset()` ~L1339, next to
     `cartSlotKeys`/`playbackKeys`): `{"x18Board", json::array()}`;
   - `header_document()` (~L2215): `{"x18Board", document_.value("x18Board", json::array())}`.
   - Whole-document saves already store unknown top-level keys
     (`replace_full_document` keeps `doc`). Confirm by saving, reloading and
     checking that the key survives.
   - API catalog: if a schema describes the header or document, add `x18Board`.
2. **Client persistence** (`useProject.ts`): copy what the fork did (`git diff
   3c3d27c origin/main -- client/app/composables/useProject.ts`, the
   `x18Board` lines):
   - hydrate `x18Board: header.x18Board ?? []`;
   - include `x18Board: toJSON(currentProject.value.x18Board) ?? []` in the
     whole-document snapshot that `saveProject()` sends (upstream's
     `buildDocumentSnapshot` or its equivalent);
   - keep the fork's note that `x18Board` is **not** in the per-section diff
     sync (it would rebuild the project mid-edit). Add `x18Board?: X18BoardButton[]`
     plus the `X18BoardButton`/`X18BoardAction` types to `types/project.ts`.
3. Copy `client/app/composables/useX18Board.ts` verbatim. Adapt imports
   (`useLiveplayServer().x18Action`).
4. `client/app/components/X18View.vue`: copy from the fork and **remove the
   Levels section**, which is X3. Leave a `section` switch with only `board`, or
   no switch at all.
5. **Workspace pane** (upstream model, see `useWorkspaceLayout.ts` header):
   - `PaneId`: add `'x18'`. Add it to `PANE_ORDER` after `'mixer'`,
     `DEFAULT_PANES.x18 = false`, and `X18_DEFAULT_PX = 420`. Check the stored
     layout reader with an old stored layout: it must ignore the missing key.
   - `MainWorkspace.vue` pane switch (~L113-115): `<X18View v-else-if="item.pane === 'x18'" />`
     before the mixer `v-else`.
   - `WorkspaceBar.vue` `PANES`: `{ id: 'x18', icon: 'tune', labelKey: 'x18.title' }`.
     Show the tile only when `x18Ip` is set, so upstream users without the
     console see no change.
   - Detaching: nothing to do. Upstream's `canDetach()` already returns `false`
     for every pane other than `cart`/`mixer` (`useWorkspaceLayout.ts` ~L159-164),
     so the X18 pane gets no pop-out button.
6. **Keyboard shortcuts:** in upstream `useCartHotkeys.ts`'s keydown handler,
   before the cart-slot lookup, add the fork's block (`git diff 3c3d27c origin/main -- client/app/composables/useCartHotkeys.ts`):
   `const x18Btn = x18Board.findButtonForEvent(e); if (x18Btn) { e.preventDefault(); e.stopPropagation(); x18Board.triggerButton(x18Btn); return; }`.
   Upstream mounts hotkeys in `MainWorkspace`, so it works whichever pane is
   visible. If `SettingsPaneKeyboard` has a conflict checker, add X18 button
   keys to it, or document that board keys win over cart keys (fork behaviour).
7. Phone deck (only if M1 is merged): add the X18 tab to the bottom bar with
   `x18Count` (fork MainWorkspace L62-67).
8. Locales: the board's `x18.*` keys (en and de from the fork), then sync.

## Verification

- Pane: toggle "X18" in the workspace bar (with `x18Ip` set). It docks, expands
  and collapses like the other panes. The tile is hidden without an IP.
- Edit mode: add a button "Band mute" (mute group 1, toggle) with key `M`.
  Pressing `M` outside edit mode toggles the desk's mute group 1. In edit mode,
  clicking the button sends nothing (`225dd72`).
- "+3 dB" relative button: moves the fader by 3 dB from the desk's current
  level (needs X1's readback).
- Save, reload: the board survives. Open an old fork show: its `x18Board` loads.
