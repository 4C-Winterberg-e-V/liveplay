# C1 — Client robustness: subscription leak and silent item-sync desync

| | |
|---|---|
| Upstream PR title | `fix(client): release engine subscriptions on unmount; retry item sync instead of silently desyncing` |
| Branch (in the fork) | `up/C1-client-sync-robustness` |
| Base | upstream target branch |
| Depends on | nothing |
| Size | ~200 lines (new util ~150, composable edits ~60) + one node test script |
| Fork sources | `d425b83` (H-19), `e672644` (projectDiff extraction), `b6b48ea` (H-17) |
| Risk | Low to medium. Successful syncs behave the same. A failed sync now retries on the next change instead of being dropped. |

## Why upstream wants this

Both bugs are present in upstream `main` (v2.5.1):

| ID | Bug | Evidence (upstream tree) |
|---|---|---|
| H-19 | `useAudioEngine()` registers `server.onCueState / onPlaybackSnapshot / onDocPatch / onMeters` and a `watch(...)` on **every call** and never releases them. It is called per `PlaylistItem` row and per `CartSlot`, so every mount adds a permanent set of WebSocket subscribers. Long sessions degrade. The `on*` helpers already return unsubscribe functions (`useLiveplayServer.ts` L172-240); nobody keeps them. | `client/app/composables/useAudioEngine.ts` L441, 495, 503, 524, 568 |
| H-17 | `syncItemsDiff()` advances the diff baseline **before** the REST calls and wraps every call in an empty `catch {}`. One failed add/remove/update/reorder (a 5xx, a reconnect window) leaves client and server permanently out of sync, with no log line. | `client/app/composables/useProject.ts` L1918-2017 |

## Already covered upstream — do NOT port

- `656cc74` (`findItemByIndex` guard): upstream fixed it independently (`1df20e9`).
- `e0596b6` (`isLocalServer.value`): upstream has no such call sites any more.
- `82eeebc` (PlaylistView watch typing): that code no longer exists upstream.

## Steps

### 1. `fix(client): release useAudioEngine subscriptions on scope dispose (H-19)`

In upstream `client/app/composables/useAudioEngine.ts`:

1. Capture the return value of each registration:
   `const stopOnCueState = server.onCueState(...)`, `stopOnPlaybackSnapshot`,
   `stopOnDocPatch`, `stopOnMeters`, and `const stopItemsWatch = watch(() => currentProject.value?.items?.length, ...)`.
2. After the last of them, add the `onScopeDispose` block from fork commit `d425b83`:
   ```ts
   if (getCurrentScope()) {
     onScopeDispose(() => {
       stopOnCueState(); stopOnPlaybackSnapshot(); stopOnDocPatch(); stopOnMeters(); stopItemsWatch();
     });
   }
   ```
   The fork (`d425b83`) calls `onScopeDispose` **unconditionally**. Add the
   `getCurrentScope()` guard shown above. Upstream also calls `useAudioEngine()`
   from composables (`useStateViewer`, `useCartHotkeys`, `useMidiController`) that
   may run outside a component scope, where an unguarded `onScopeDispose` logs a
   Vue warning. Nuxt auto-imports `onScopeDispose` and `getCurrentScope`. Add
   explicit imports only if the file already imports from `vue`.
3. Leave the handler bodies unchanged. Upstream changed them since v2.4.3, so
   **never** paste the fork's version of the handlers.

### 2. `refactor(client): extract the item-sync diff into utils/projectDiff.ts`

1. `git show origin/main:client/app/utils/projectDiff.ts > client/app/utils/projectDiff.ts`
   (copy verbatim). The fork version already contains upstream's
   `withoutChildren()` rule for group updates, so it computes exactly what upstream's
   inline code computes.
2. Before replacing the inline code, compare the two diff rules line by line:
   - upstream inline `flatten` (useProject.ts ~L1900-1916) against `flattenItems`;
   - upstream steps 1-5 (~L1940-2016) against `computeItemDiff`.

   They must match: moves, removes, adds, updates with `withoutChildren`, and
   reorders that exclude cart-only items, compared on common items only. If
   upstream has drifted, change `projectDiff.ts` to match upstream, not the other
   way round.

### 3. `fix(client): don't swallow item-sync failures; roll back and retry (H-17)`

In `useProject.ts`:

1. `import { computeItemDiff, flattenItems } from '~/utils/projectDiff';`
2. Delete the inline `flatten` helper.
3. Replace the body of `syncItemsDiff()` **from `const prev = flatten(...)` to the
   end of the function** with the fork's final version. Copy it from
   `git show origin/main:client/app/composables/useProject.ts`: search for
   `async function syncItemsDiff` and copy from `const prev = flattenItems(` to
   the end of the function. Keep upstream's early-return lines above it
   (`srv.connected`, `currentProject`, `itemsToJSON`, `stableJson` change check).
4. The update step must keep sending the group **without** `children`, as
   upstream does. This holds already: `computeItemDiff` pushes
   `{ uuid, item: nowCompare }`, the `withoutChildren(...)` copy (fork
   `projectDiff.ts` ~L120-129), so the fork loop
   `srv.updateProjectItem(uuid, item)` sends the stripped object. Do not
   "simplify" this away.

## Tests (upstream style, no Vitest)

Convert `client/test/projectDiff.test.ts` (fork, Vitest) into
`client/tests/project-diff-tests.js`. Follow `client/tests/mixer-regression-tests.js`:

```js
// usage: node client/tests/project-diff-tests.js
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
const ts = require('typescript');
const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'utils', 'projectDiff.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const ctx = vm.createContext({ exports: {}, module: { exports: {} } });
vm.runInContext(js, ctx);
const { flattenItems, computeItemDiff } = ctx.exports;
// ...one block per Vitest `it(...)`: build prev/curr trees, assert the ops.
console.log('project-diff-tests: all passed');
```

Translate every `expect(x).toEqual(y)` into `assert.deepEqual(JSON.parse(JSON.stringify(x)), y)`,
because vm-context objects have a different prototype. Keep all 12 cases. Add
the script to the "Checks" table in `docs/DEVELOPMENT.md`.

## Verification

```sh
npm ci
node client/tests/project-diff-tests.js
node client/tests/mixer-regression-tests.js        # regression
npm run build:client
```

Manual check in `npm run dev`, with the playlist open in two windows (main
window plus a browser tab or a second client):

1. Add, move into a group, reorder and delete items. The other client follows
   each change.
2. Stop the server for ~5 s, edit a cue name, then restart the server. After
   reconnect, make one more edit. Both edits must arrive on the other client.
   Before this fix the first edit was lost.
3. Open and close large groups and scroll a long playlist for a while. In
   DevTools → Memory, the count of WebSocket subscriber callbacks must not
   grow. You can also log `cueStateSubscribers.size` temporarily; remove that
   log before committing.

## Done when

- [ ] Three commits as above. No behaviour change on the success path.
- [ ] Node test green, `npm run build:client` green.
- [ ] No Vitest, no `client/test/` directory, no lockfile change.
