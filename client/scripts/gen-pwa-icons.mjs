#!/usr/bin/env node
// Generate the square PWA icons from the SVG logo.
//
// Why this exists: the shipped raster icons are all 4:3 (1080x820, 2160x1640,
// 4092x3105). A web-app manifest needs SQUARE icons — Android crops or letterboxes
// anything else, and a `maskable` icon is cropped to a circle on many launchers,
// so its artwork has to sit inside a 40% safe radius. Rendering from the vector
// source rather than resampling the 4:3 rasters keeps the edges clean.
//
// Rendered with the Playwright Chromium that is already a devDependency of the
// repo's test tooling; no image library is added. Re-run with:
//   node scripts/gen-pwa-icons.mjs
// and commit the result — CI does not regenerate them.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SVG = readFileSync(resolve(ROOT, 'public/assets/icons/SVG/liveplay-icon-darkmode@web.svg'), 'utf8');
const OUT = resolve(ROOT, 'public/assets/icons/pwa');

// The app's dark surface, so the icon reads as part of the product rather than
// floating on white. Matches --color-background in assets/styles/main.scss.
const BG = '#161616';

const TARGETS = [
  // `any` icons: the launcher shows them as-is, so the logo can fill more.
  { file: 'icon-192.png', size: 192, inset: 0.14, bg: BG },
  { file: 'icon-512.png', size: 512, inset: 0.14, bg: BG },
  // `maskable`: launchers crop to a circle/squircle. Keep the artwork inside the
  // 40% safe radius, which means a generous inset and a full-bleed background.
  { file: 'icon-maskable-512.png', size: 512, inset: 0.26, bg: BG },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
});

for (const t of TARGETS) {
  const ctx = await browser.newContext({
    viewport: { width: t.size, height: t.size },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const pad = Math.round(t.size * t.inset);
  await page.setContent(`<!doctype html><meta charset="utf-8">
    <style>
      html, body { margin: 0; padding: 0; width: ${t.size}px; height: ${t.size}px; }
      body { background: ${t.bg}; display: flex; align-items: center; justify-content: center; }
      /* The mark is 4:3, so constrain by width and let height follow. */
      svg { width: ${t.size - pad * 2}px; height: auto; display: block; }
    </style>
    ${SVG}`);
  await page.screenshot({ path: resolve(OUT, t.file), omitBackground: false });
  await ctx.close();
  console.log(`wrote ${t.file}  ${t.size}x${t.size}  inset ${Math.round(t.inset * 100)}%`);
}

await browser.close();
console.log(`\nIcons in ${OUT}`);
