#!/usr/bin/env node
// =============================================================================
// scripts/ensure-server.js
// -----------------------------------------------------------------------------
// Run before `nuxt dev` / electron at the monorepo root. Verifies the C++
// audio server binary exists AND is up to date; builds (or rebuilds) it when
// it's missing or any server source is newer than the binary. A no-op when
// the binary is already current (fast dev-loop iteration). Without the
// freshness check, edits to the C++ server were silently ignored under
// `pnpm dev` — the stale binary kept running. Cross-platform, no shell syntax.
// =============================================================================
const fs        = require('node:fs');
const path      = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT  = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(REPO_ROOT, 'server');
const BUILD_DIR  = path.join(SERVER_DIR, 'build');
const EXE_NAME   = process.platform === 'win32' ? 'liveplay-server.exe' : 'liveplay-server';

// Candidate output locations across single-config and multi-config generators.
const BIN_CANDIDATES = [
  path.join(BUILD_DIR, 'Release', EXE_NAME),
  path.join(BUILD_DIR, EXE_NAME),
];

function findBinary() {
  return BIN_CANDIDATES.find(p => fs.existsSync(p));
}

// Newest mtime (ms) across everything that feeds the server build: sources,
// headers, and the CMake/vcpkg manifests. Used to decide whether a present
// binary is stale relative to the tree.
function newestSourceMtime() {
  let newest = 0;
  const visit = (p) => {
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) {
      for (const entry of fs.readdirSync(p)) visit(path.join(p, entry));
    } else if (st.mtimeMs > newest) {
      newest = st.mtimeMs;
    }
  };
  visit(path.join(SERVER_DIR, 'src'));
  visit(path.join(SERVER_DIR, 'include'));
  visit(path.join(SERVER_DIR, 'CMakeLists.txt'));
  visit(path.join(SERVER_DIR, 'CMakePresets.json'));
  visit(path.join(SERVER_DIR, 'vcpkg.json'));
  return newest;
}

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts });
  if (res.status !== 0) {
    process.exitCode = res.status ?? 1;
    process.exit(process.exitCode);
  }
}

function configure() {
  // Pick a preset that matches the host. Falls through to 'default' (Ninja)
  // on Unix; vs2022 on Windows so users don't need Ninja on PATH.
  // Run from SERVER_DIR: `cmake --preset` reads CMakePresets.json from the
  // current working directory.
  const preset = process.platform === 'win32' ? 'vs2022' : 'default';
  run('cmake', ['--preset', preset], { cwd: SERVER_DIR });
}

function build() {
  // `cmake --build --preset` also resolves the preset file relative to the
  // working directory, so build from SERVER_DIR (not the repo root).
  const preset = process.platform === 'win32' ? 'vs2022' : 'default';
  run('cmake', ['--build', BUILD_DIR, '--preset', preset], { cwd: SERVER_DIR });
}

const existing = findBinary();
if (existing) {
  const binMtime = fs.statSync(existing).mtimeMs;
  if (newestSourceMtime() <= binMtime) {
    console.log(`[liveplay] server binary up to date: ${existing}`);
    process.exit(0);
  }
  // Sources changed since the last build — fall through to an incremental
  // rebuild so the running app actually picks up the new server code.
  console.log('[liveplay] server sources changed since last build — rebuilding (incremental).');
} else {
  console.log('[liveplay] server binary not found — building once. Subsequent dev runs skip this step when unchanged.');
}

// Configure step is idempotent; skip if CMakeCache.txt is already there.
const cmakeCache = path.join(BUILD_DIR, 'CMakeCache.txt');
if (!fs.existsSync(cmakeCache)) configure();
build();

const built = findBinary();
if (!built) {
  console.error('[liveplay] build finished but binary still missing under', BUILD_DIR);
  process.exit(1);
}
console.log(`[liveplay] built ${built}`);
