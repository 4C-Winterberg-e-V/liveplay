# T2 — CI: run the C++ unit suites on every server PR; Node 22 LTS

| | |
|---|---|
| Upstream PR title | `ci: build and run the unit suites in build-server; move workflows to Node 22 LTS` |
| Branch (in the fork) | `up/T2-ci-unit-tests-node22` |
| Base | upstream target branch |
| Depends on | nothing. If S1/A1/X1 land first, their new suites are picked up automatically. |
| Size | ~15 lines of YAML |
| Fork sources | `3fa1991` (the CI half: `-DLIVEPLAY_BUILD_TESTS=ON` + `ctest` step), `329ff26` (Node 22) |
| Risk | Low. Watch for an existing suite that fails on a CI platform; fix it or report it, never skip it. |

## Why upstream wants this

- Upstream has 9 framework-free CTest suites (`docs/DEVELOPMENT.md`, "Checks"),
  but `.github/workflows/build-server.yml` never builds or runs them. It
  configures without `-DLIVEPLAY_BUILD_TESTS=ON` and only smoke-runs
  `liveplay-server --help`.
- `build-release.yml` pins `node-version: '20'`. Node 20 reached end-of-life
  in April 2026.

## Do NOT port

- doctest, `server/tests/CMakeLists.txt`, `server/tests/test_main.cpp` or the
  vcpkg doctest dependency from `3fa1991`. Upstream registers framework-free
  test binaries directly in `server/CMakeLists.txt`.
- `.github/workflows/check-client.yml` (pnpm, vue-tsc, Vitest). See the optional
  package T3 in the master plan.

## Steps

1. `.github/workflows/build-server.yml`:
   - In the configure step(s), add `-DLIVEPLAY_BUILD_TESTS=ON` next to the
     existing `-D...` flags. There may be one configure step per OS; add it to
     each.
   - After the build step, add (fork wording):
     ```yaml
     # Unit tests (CTest). The x64-on-arm64 macOS slice runs its x86_64 test
     # binaries under the Rosetta installed above.
     - name: Unit tests (ctest)
       working-directory: server
       shell: bash
       run: ctest --test-dir build --build-config Release --output-on-failure
     ```
     Check the build directory name the workflow really uses (`cmake --build build ...`
     → `build`).
2. `.github/workflows/build-release.yml` and `deploy-docs.yml`: change
   `node-version: '20'` → `'22'`. Keep the `npm install -g npm@11` /
   `npm ci --include=optional` steps as they are.
3. Push the branch **to the fork first** and let the fork's Actions run the
   workflow on all four platforms. If a suite fails on a platform, fix the test
   when the fix is obvious and in scope; otherwise write the failure into the PR
   description. Never disable a suite.

## Done when

- [ ] build-server green on all matrix entries in the fork, with ctest output visible.
- [ ] Release/docs workflows use Node 22. No other workflow changes.
