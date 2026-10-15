# S1 — Server robustness fixes

| | |
|---|---|
| Upstream PR title | `fix(server): bound trigger recursion, keep broadcast cues alive, repair replaced documents, refuse pathological media` |
| Branch (in the fork) | `up/S1-server-robustness` |
| Base | upstream target branch (see master plan §4) |
| Depends on | nothing |
| Size | ~150 lines of C++ + 1 new header + 1 e2e suite |
| Fork sources | `6622213` (H-15 half only), `2fae07d` (H-14), `2abe832` (M-16), `cb4723f` (M-04/H-20) |
| Risk | Low. H-15 adds an early return; H-14 extends object lifetime on a non-audio thread; M-16 runs an existing repair pass; M-04/H-20 refuse only absurd files. Nothing touches the render thread. |

## Why upstream wants this

The fork's code audit (`CODE_REVIEW.md`) found these bugs, and they are **still
present in upstream `main` (v2.5.1)**. Each one was re-verified against upstream
code:

| ID | Bug in upstream v2.5.1 | Evidence (upstream tree) |
|---|---|---|
| H-15 | `play_item()` runs the start behaviour with `play_item(start_behavior_target_uuid)`, and `trigger_item()` recurses into group children, with **no depth bound**. Cue A that starts B, with B starting A, recurses until the stack overflows and the server crashes mid-show. | `server/src/core/project_state.cpp` ~L3316-3321 (`play_item` tail), ~L3910-3986 (`trigger_item`) |
| H-14 | The broadcast thread calls `engine_.find_cue()`, which returns a **raw** `PlaybackItem*` after releasing the engine lock. A concurrent `unload_cue()` erases the owning `shared_ptr`, so the meter loop can dereference freed memory. | `server/src/net/control_server.cpp` L1127 and L1260 (inside `broadcast_loop()`, L1096-1399); `server/src/audio/engine.cpp` `unload_cue()` erases `items_` |
| M-16 | `replace_full_document()` (`PUT /api/project/document`) stores the incoming JSON with `document_ = doc;` and skips `detect_and_repair()`, which every load path runs. Duplicate UUIDs or a numeric `lastModified` get into live state. | `project_state.cpp` ~L2274 (`replace_full_document`), `detect_and_repair` at ~L267 |
| M-04 / H-20 | `compute_waveform()` and the metadata duration probe hand any file to the decoder. A huge file, or one claiming hundreds of channels, makes the server allocate `channels × buckets` buffers. | `server/src/meta/waveform.cpp`, `server/src/meta/metadata.cpp`: **unchanged upstream since v2.4.3** |

## Already covered upstream — do NOT port

- **M-17 atomic save** (`6622213`, save half): upstream `ProjectState::save()`
  already writes `<file>.tmp` and renames it over the target.
- **H-16 LTC encoder reset** (`c68ed7f`): upstream `render_block()` calls
  `ltc_->set_offset(...)`, not `configure(...)`, so it no longer resets every block.
- The doctest harness from `3fa1991`: upstream uses framework-free test binaries.
  See the T1 test conversion rules in the master plan.

## Steps

Work on a fresh branch from the upstream target branch. Make **one commit per
fix**, in this order, with the subject lines shown.

### 1. `fix(server): refuse pathological media before decoding (M-04, H-20)`

Upstream never touched these files, so the fork commit applies as-is:

```sh
git cherry-pick -x cb4723f
```

This adds `server/include/liveplay/meta/media_limits.hpp` and small guards in
`server/src/meta/metadata.cpp` and `server/src/meta/waveform.cpp`. If the
cherry-pick conflicts, stop and re-check; it should not.

### 2. `fix(server): bound start-behaviour / group recursion (H-15)`

In `server/src/core/project_state.cpp`:

1. Directly above the definition of `ProjectState::play_item(` (~L2980), insert
   the anonymous-namespace guard. Copy it verbatim from fork commit `6622213`
   (`git show 6622213 -- server/src/core/project_state.cpp`, the hunk that adds
   `kMaxTriggerRecursionDepth`, `g_trigger_recursion_depth`,
   `TriggerRecursionGuard`).
2. In `play_item(...)`, as the **first statements of the function body, before
   the existing `try {`**, add:
   ```cpp
   TriggerRecursionGuard rec_guard;
   if (!rec_guard.ok) {
       Logger::warn("play_item: recursion depth limit ({}) exceeded for '{}' — "
                    "aborting (likely a cyclic startBehavior chain)",
                    kMaxTriggerRecursionDepth, uuid);
       return false;
   }
   ```
3. Add the same block at the top of `trigger_item(...)` (~L3910). Use
   `"trigger_item: ..."` in the message and mention "group / start-behavior
   chain".
4. Leave the existing upstream comments in place. Do not move the `try`.

### 3. `fix(server): keep cues alive while the broadcast loop reads them (H-14)`

1. In `server/include/liveplay/audio/engine.hpp`, next to
   `PlaybackItem* find_cue(const CueId& id) const;` (~L454), add the declaration
   and comment of `find_cue_shared` from fork commit `2fae07d`.
2. In `server/src/audio/engine.cpp`, directly after `AudioEngine::find_cue(...)`,
   add:
   ```cpp
   std::shared_ptr<PlaybackItem> AudioEngine::find_cue_shared(const CueId& id) const {
       std::lock_guard lock{mutex_};
       auto it = items_.find(id.value);
       return it != items_.end() ? it->second : nullptr;
   }
   ```
3. In `server/src/net/control_server.cpp`, inside `ControlServer::broadcast_loop()`,
   change the two lookups:
   - in the `append_meter_for` lambda (~L1127):
     `auto* item = engine_.find_cue(cue_id);` → `auto item = engine_.find_cue_shared(cue_id);`
   - in the cue_state edge scan (~L1260):
     `auto* item = engine_.find_cue(cue.id);` → `auto item = engine_.find_cue_shared(cue.id);`

   Add the one-line comment from `2fae07d` at each site. Do **not** change the
   other `find_cue` callers. They are synchronous request handlers and are out
   of scope.

### 4. `fix(server): repair a replaced document like a loaded one (M-16)`

In `ProjectState::replace_full_document(const json& doc)` (~L2274):

1. After `if (!doc.is_object()) return false;`, add:
   ```cpp
   // Run the same repair pass every load path runs: PUT /api/project/document
   // must not be a way around duplicate-UUID removal / lastModified repair.
   json repaired = doc;
   RepairInfo repair = detect_and_repair(repaired);
   if (repair.repaired) {
       Logger::warn("ProjectState::replace_full_document: project repaired ({} issue(s)).",
                    repair.issues.size());
       for (const auto& issue : repair.issues) Logger::warn("  - {}", issue);
   }
   ```
2. In the rest of the function, use `repaired` wherever upstream reads `doc`:
   `doc.contains("buses")`, `bus_schema_of(doc)`, and `document_ = doc;` (make that
   last one `document_ = std::move(repaired);`). Check with
   `grep -n '\bdoc\b'` inside the function that no reference to the unrepaired
   `doc` remains after the repair.

## Tests (upstream style)

Add **one** e2e suite, `server/tests/e2e/robustness-e2e.js`. Copy the
boilerplate (`rest()`, `post()`, `waitFor()`, argument parsing, exit code) from
`server/tests/e2e/transport-fixes-e2e.js`. Usage: `node robustness-e2e.js <port> <wavPath>`.

1. **H-15:** use `PUT /api/project/document` to load a document with two audio
   items `cyc-a` and `cyc-b` pointing at `<wavPath>`:
   - `cyc-a` has `"startBehavior": {"action":"play","targetUuid":"cyc-b"}`, and
     `cyc-b` has `{"action":"play","targetUuid":"cyc-a"}`. These are the fields
     `play_item()` parses (~L3060-3064). The server only acts on `"play"` /
     `"stop"`. The UI's own `play-item` action is handled in the client, so this
     server path is reached through the API or an imported/legacy project.
     Mention that in the PR.
   - Wait for `/api/project/progress` to report `loading:false`.
   - `POST /api/project/items/cyc-a/play`. Then assert that `GET /api/project/items`
     still answers within 2 s, i.e. the server did not crash.
   - Finish with `POST /api/transport/stop_all {fade_ms:0}`.
2. **M-16:** `PUT /api/project/document` a document whose `items` contains the
   same uuid twice and whose `lastModified` is a number. Then
   `GET /api/project/document` (or `/api/project/items`) and assert the uuid
   appears once and `lastModified` is a string.
3. Register the suite in `server/tests/e2e/README.md`, in the "Suites using a
   running server" table.

Optional, only if simple: a framework-free unit test for `media_file_too_large()`
(`server/tests/media_limits_test.cpp`, registered in `server/CMakeLists.txt`
inside `if(LIVEPLAY_BUILD_TESTS)` next to `liveplay-waveform-tests`). Set
`LIVEPLAY_MAX_MEDIA_BYTES=10` and check that a 20-byte temp file is refused and
a missing file is **not** refused (fail-open).

H-14 is a race and cannot be tested deterministically. Say so in the PR.

## Verification

```sh
# server (presets are read from the CWD, so run from server/)
cd server
cmake --preset default -DLIVEPLAY_BUILD_TESTS=ON      # Windows: --preset vs2022
cmake --build --preset default                        # Windows: --preset vs2022
ctest --test-dir build -C Release --output-on-failure # all suites green (+1 if you added media_limits)
cd ..

# e2e (needs an audio device)
node server/tests/e2e/gen-signal.js /tmp/test-signal.wav
npm run server:run -- --port 4500 &
node server/tests/e2e/robustness-e2e.js 4500 /tmp/test-signal.wav
node server/tests/e2e/transport-fixes-e2e.js 4500            # regression: must stay green
node server/tests/e2e/migration-e2e.js 4500 /tmp/test-signal.wav
```

Manual check: open a show and play/stop a few cues for a minute while meters run.
Nothing changes in the UI.

## PR description outline

- One paragraph per fix: the bug, how it shows up on stage, the fix, and the
  evidence (function names).
- Note that these came out of a code audit of a downstream fork. State that the
  atomic-save and LTC findings from the same audit were already fixed upstream
  and are deliberately not included.
- Testing: list the suites run and on which OS.

## Done when

- [ ] Four commits, each building on its own.
- [ ] `ctest` green, new e2e green, `transport-fixes-e2e` and `migration-e2e` still green.
- [ ] No other files touched: no version bump, no lockfile, no docs other than the e2e README row.
