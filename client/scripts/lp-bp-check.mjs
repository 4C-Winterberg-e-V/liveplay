#!/usr/bin/env node
// Breakpoint drift guard.
//
// The mobile layout used to hang off `@media (max-width: 768px)` hand-copied
// into ten component files, which is how a phone in landscape ended up with the
// desktop layout. The fix replaced it with three canonical query strings — but a
// convention nobody enforces is a convention that drifts back. This makes the
// drift a build failure instead.
//
// No new dependency: prefers ripgrep, falls back to a plain fs walk.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SCAN_DIRS = ['app', 'assets/styles'];
const EXTS = ['.vue', '.scss', '.css'];

// The only @media bodies allowed to mention our breakpoint numbers.
const SANCTIONED = [
  '(max-width: 767px), (max-width: 1024px) and (any-pointer: coarse), (max-height: 559px) and (any-pointer: coarse)',
  '(max-height: 559px) and (any-pointer: coarse) and (min-width: 600px)',
  '(any-pointer: coarse)',
  '(any-pointer: fine)',
  '(any-hover: hover) and (any-pointer: fine)',
  '(prefers-reduced-motion: reduce)',
];

// Tokens that exist only inside the compact block. A file using one without any
// sanctioned @media line is leaking the phone scale into a desktop rule.
const COMPACT_ONLY_TOKENS = [
  '--lp-tap', '--lp-sep', '--lp-row-h', '--lp-tap-icon',
  '--lp-gap-tap', '--lp-cart-row-h', '--lp-panel-header-h', '--lp-header-h',
];

function listFiles() {
  try {
    const out = execFileSync('rg', ['--files', ...SCAN_DIRS], { cwd: ROOT, encoding: 'utf8' });
    return out.split('\n').filter(f => EXTS.some(e => f.endsWith(e)));
  } catch {
    const acc = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (EXTS.some(e => p.endsWith(e))) acc.push(relative(ROOT, p));
      }
    };
    for (const d of SCAN_DIRS) walk(join(ROOT, d));
    return acc;
  }
}

const errors = [];

for (const file of listFiles()) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const lines = text.split('\n');
  let sanctionedMediaCount = 0;

  lines.forEach((line, i) => {
    const at = `${file}:${i + 1}`;

    // 1. The retired breakpoints must not come back. Only inside @media —
    //    `max-width: 480px` as a box constraint is a perfectly good declaration.
    if (line.includes('@media')) {
      if (/max-width:\s*768px/.test(line)) {
        errors.push(`${at}  retired breakpoint 768px — use the compact query instead\n    ${line.trim()}`);
      }
      if (/max-width:\s*480px/.test(line)) {
        errors.push(`${at}  retired breakpoint 480px — fold this into the compact query\n    ${line.trim()}`);
      }
    }

    // 2/3. Every @media body must be byte-identical to a sanctioned string.
    const m = line.match(/@media\s+(.+?)\s*\{/);
    if (!m) return;
    const body = m[1].trim();
    if (SANCTIONED.includes(body)) { sanctionedMediaCount++; return; }
    // Anything mentioning our numbers but not matching exactly is drift.
    if (/max-width|max-height|any-pointer|hover|pointer/.test(body)) {
      errors.push(`${at}  non-canonical @media query\n    got:      ${body}\n    expected: one of\n${SANCTIONED.map(s => '      ' + s).join('\n')}`);
    }
  });

  // 4. Compact-only tokens must not be read outside a compact/coarse block.
  if (sanctionedMediaCount === 0) {
    for (const token of COMPACT_ONLY_TOKENS) {
      if (text.includes(`var(${token}`)) {
        errors.push(`${file}  reads ${token} but declares no compact @media block — the phone touch scale is leaking into a desktop rule`);
      }
    }
  }
}

if (errors.length) {
  console.error(`\nlp:bp-check found ${errors.length} problem(s):\n`);
  for (const e of errors) console.error('  ✗ ' + e + '\n');
  process.exit(1);
}
console.log('lp:bp-check: breakpoints and compact tokens are consistent.');
