# M1 — Phone/tablet layout (compact shell)

| | |
|---|---|
| Upstream PR title | `feat(client): a touch-first compact layout for phones and tablets` |
| Branch (in the fork) | `up/M1-phone-layout` (stack on W1 if W1 is not merged yet) |
| Depends on | **W1** (to test on real phones), **U1** item 3 (per-device Show Mode). Without W2 you test with `npm run dev:client` over the LAN. |
| Size | **Largest package**: ~1,200-1,800 lines, mostly CSS. Split into the three commits below, and into two PRs if review asks (M1a foundation+shell, M1b component compaction). |
| Fork sources | `babaab9`, `6803d5d`, plus June commits `f6d14bd`, `f91917d`, `1b447b7`, `c4d7321`, `84a675f`, `e520cac`, `dbbe569`, `bb4b67b`, `ce6e81f`, `004acfa`, `61f4237` (all superseded by `babaab9` where they overlap), `06a2dd3`, `f64211e` |
| Risk | High effort, low runtime risk. Everything is behind the compact media query, so desktop must pixel-match. |

> **Recommendation for whoever executes this:** this is the package where a
> cheaper model is most likely to struggle. Upstream rebuilt `MainWorkspace`,
> `ProjectHeader`, `PlaybackControls`, `PlaylistItem`, `CartSlot` and
> `PropertiesPanel` since v2.4.3, so the fork's diffs **cannot be applied**.
> The fork is the **spec**, and the work is re-implementing it on upstream's
> components. Do it in small commits and take screenshots after each (see
> Verification). Consider a stronger model or human review for this package.

## Spec (what must work at the end)

The fork README section "Operating LivePlay from a phone or tablet" and the
`babaab9` commit message are the authoritative spec. In short:

1. **Breakpoints:** the three canonical queries in
   `client/app/composables/useCompactLayout.ts` (compact, wide-short, coarse),
   used **byte-identically** in CSS. Layout follows viewport size. Anything that
   can make sound follows `(any-pointer: coarse)` only. The detached cart window
   with a mouse must never behave like a touchscreen.
2. **One surface at a time:** a bottom deck-tab row (Playlist / Cart / Mixer,
   and X18 once X2 lands) with live counts. The active pane gets the full height.
   In upstream's model this means: on compact, render exactly one docked pane
   (the deck pane), hide splitters and `PaneControls` expand/detach, and hide
   the header workspace bar. The phone has its own `localStorage`, so it does
   not disturb the desktop's stored layout.
3. **Transport always reachable:** a permanent bottom bar with PLAY NEXT and
   STOP ALL (`TransportButtons.vue`, new). It is a flex **sibling** of the
   content, not an overlay. A `ResizeObserver` publishes `--lp-bottom-h` so
   sheets stop above it.
4. **Slim header:** title, clock (a clock is shown when fullscreen hides the
   status bar), and an overflow menu (⋯) holding the actions that do not fit,
   including a **Full screen** toggle (`lpToggleFullscreen`).
5. **Properties panel** opens as a full-screen sheet. **Dialogs are bottom sheets**
   (one shared contract in `main.scss`). No dialog may exceed the viewport, and
   inputs are ≥16px so iOS does not zoom.
6. **iOS safe areas:** `viewport-fit=cover` plus `env(safe-area-inset-*)` paddings.
7. **Compact defaults:** open in Show Mode (`06a2dd3`) and set U1's "follow Show
   Mode" to off on first compact launch. The output-trim control is hidden on
   compact (`06a2dd3`). Set-as-next stays reachable in Show Mode on a phone (`f64211e`).
8. **Dead-air countdown** becomes a full-width banner on compact, instead of
   blanking the project title.

Touch controls (pointer events, one-line rows, cart pads, seek) are **M2**, not this PR.

## Steps

### Commit 1 — `feat(client): compact layout foundation`
1. Copy verbatim: `client/app/composables/useCompactLayout.ts`,
   `client/scripts/lp-bp-check.mjs`. In comments, change `pnpm lp:bp-check` → `npm run lp:bp-check`.
2. `client/package.json` scripts: `"lp:bp-check": "node scripts/lp-bp-check.mjs"`.
   Do **not** add the fork's `test` script, which runs Vitest. Add the check to
   the "Checks" table in `docs/DEVELOPMENT.md`.
3. `client/assets/styles/variables.scss`: append the fork's breakpoint
   documentation block and the four `$bp-*` variables (fork diff, +34 lines).
4. `client/assets/styles/main.scss`: port the fork's **token and contract**
   blocks. `git diff 3c3d27c origin/main -- client/assets/styles/main.scss`
   shows them: the `:root` defaults (`--lp-bottom-h: 0px`, …), the compact
   `:root` block (`--lp-tap*`, `--lp-input-*`, `--lp-panel-header-h`,
   `--lp-sheet-top`), the wide-short block, the coarse/fine blocks, the
   reduced-motion block, and the bottom-sheet modal contract. Check that each
   selector they target still exists upstream. Upstream renamed some modal
   classes; grep for them.
5. `client/nuxt.config.ts`: viewport meta
   `width=device-width, initial-scale=1, viewport-fit=cover`. The other
   PWA/meta tags belong to M3.
6. Run `npm run lp:bp-check`. It must pass, because no component uses the
   queries yet.

### Commit 2 — `feat(client): compact shell — deck tabs, bottom transport bar, slim header`
1. Copy `client/app/components/TransportButtons.vue` from the fork. Adapt it to
   upstream's transport API: check the function names it calls on
   `useAudioEngine`/`useProject`, such as play-next, `stopAllCues` and
   `autoNextItemUuid`, against upstream.
2. `MainWorkspace.vue` (upstream): add the compact deck.
   - `const deckPane = useState<PaneId>('lp.deckPane', () => 'playlist')`
   - In the compact media query, CSS hides every docked pane except
     `.lp-deck--<deckPane>`, and hides splitters. Use upstream's per-pane
     wrapper element; inspect the `v-for` over panes around L100-120.
   - Add the bottom bar markup from the fork (`origin/main` MainWorkspace
     L35-72) **without the X18 tab** (X2 adds it). It holds tabs for
     playlist/cart/mixer with counts (`cueCount`, `cartCount`, and for the mixer
     the bus count), then `<TransportButtons class="lp-transport-bar" />`.
   - Add the `ResizeObserver` that publishes `--lp-bottom-h`, from fork
     L555-580, including cleanup on unmount.
3. `ProjectHeader.vue` (upstream rebuilt it around `WorkspaceBar` and measured
   compaction): on compact, hide `WorkspaceBar` and the inline actions, and add
   the overflow menu from the fork (`showHeaderMenu`, fork ProjectHeader ~L90-130).
   Its items are Settings (deep link `#/settings`), the Show Mode switch,
   **Full screen** (`lpFullscreenSupported()`/`lpToggleFullscreen()`), and the
   upstream header actions that no longer fit. Add the fullscreen clock
   (`isFullscreen`). Keep upstream's desktop header **byte-identical in
   behaviour**.
4. `PropertiesPanel.vue`: on compact, render as a full-screen sheet with a
   close button (fork `84a675f` + `babaab9`). It must stop above `--lp-bottom-h`.
5. Compact defaults: in `useUiMode.ts`, on the first client-side init where the
   compact query matches and no stored mode exists, start in `playback` (Show
   Mode), and set U1's follow flag to `false` if it is unset. In
   `PlaybackControls.vue`, hide the output-trim control under the compact query.
6. Dead-air countdown: compact CSS turns it into a full-width banner. Find the
   element upstream uses (search "countdown" / "deadAir" in `ProjectHeader`
   and `PlaybackControls`).

### Commit 3 — `feat(client): compact styles for dialogs and the welcome screen`
Apply the fork's compact `@media` blocks to these upstream components, adapting
selectors: `AudioImportModal`, `ServerFilePickerModal`, `YouTubeImportModal`,
`WelcomeScreen`, `ConnectionLostModal`, `LoginScreen` (new upstream; give it
the same treatment), `SettingsPage` (rail becomes a top select or a collapsible
list on compact; this is new work, keep it minimal), `Btn`, `ActionButton`.
For each, take the fork file's compact block
(`git show origin/main:client/app/components/<X>.vue`, search `@media (max-width: 767px)`)
and map its selectors onto the upstream markup.

## Verification (required, with screenshots in the PR)

- `npm run lp:bp-check` and `npm run build:client` green.
- Use Playwright, which is preinstalled in Claude Code cloud sessions
  (`executablePath: '/opt/pw-browsers/chromium'`), or a phone. Take screenshots
  at **393×852, 360×740, 852×393 (coarse), 768×1024 (coarse) and 1280×800
  (fine)**. Attach them to the PR. Acceptance:
  - no horizontal overflow (`document.documentElement.scrollWidth <= innerWidth`);
  - every primary control ≥44px (`getBoundingClientRect` audit, as the fork
    did; see the `babaab9` message);
  - PLAY NEXT and STOP ALL visible on every compact screen, including with
    properties open;
  - at 1280×800, compare against an upstream screenshot. The pixel difference
    must be within noise. The desktop must not change.
- On a real phone via W2: Show Mode on open, deck tabs switch panes, header menu
  works, and full screen works on Android.

## Done when

- [ ] Three commits, screenshots attached, desktop unchanged, bp-check green.
