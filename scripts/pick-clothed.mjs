#!/usr/bin/env node
// Rank images by exposed-skin fraction (a "clothed-ness" proxy) using ffmpeg.
// Handy for pre-filtering AI art folders before releasing to the gallery.
//
// Usage:
//   node scripts/pick-clothed.mjs --dir <folder> [--top N] [--copy <dest>] [--threshold F]
//
// --top N          print top N most-clothed images (default 25)
// --copy <dest>    copy the most-clothed images to dest (default: all below threshold)
// --threshold F    skin-fraction cutoff for --copy (default 0.15)
//
// Output columns: rank, skin% (whole frame), center% (middle 50%), size, filename.
// Lower skin% = more clothed. 0.15 = clothed fashion shot, 0.30+ = bikini/undressed.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function arg(name, def = null) {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
}

const dir = arg('--dir');
if (!dir || !fs.existsSync(dir)) {
  console.error('Usage: node scripts/pick-clothed.mjs --dir <folder> [--top N] [--copy <dest>] [--threshold F]');
  process.exit(2);
}
const top = parseInt(arg('--top', '25'), 10);
const copyDest = arg('--copy');
const threshold = parseFloat(arg('--threshold', '0.15'));

const IMG = /\.(png|jpe?g|webp)$/i;
const files = fs.readdirSync(dir).filter((f) => IMG.test(f)).sort();

const W = 48; // decode scale — plenty for a skin-fraction estimate

function skinScore(filePath) {
  const res = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', filePath, '-vf', `scale=${W}:${W}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  if (res.status !== 0 || !res.stdout || res.stdout.length < W * W * 3) return null;

  const px = res.stdout;
  const isSkin = (i) => {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return (
      r > 95 && g > 40 && b > 20 &&
      r > g && r > b &&
      mx - mn > 15 &&
      Math.abs(r - g) > 15
    );
  };

  let total = 0, skin = 0, cSkin = 0, cTotal = 0;
  const half = Math.floor(W / 2);
  const q = Math.floor(W / 4); // center box = middle 50%
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      total++;
      if (isSkin(i)) skin++;
      const inCenter = x >= q && x < W - q && y >= q && y < W - q;
      if (inCenter) {
        cTotal++;
        if (isSkin(i)) cSkin++;
      }
    }
  }
  return {
    skin: skin / total,
    center: cTotal ? cSkin / cTotal : 0,
  };
}

const rows = [];
for (const f of files) {
  const fp = path.join(dir, f);
  const s = skinScore(fp);
  if (!s) {
    console.error(`skip (undecodable): ${f}`);
    continue;
  }
  const size = fs.statSync(fp).size;
  rows.push({ name: f, skin: s.skin, center: s.center, size });
}

rows.sort((a, b) => a.skin - b.skin);

console.log('');
console.log('  #  skin%  center%    size   file');
console.log('  -- -----  -------  -------  ----');
rows.slice(0, top).forEach((r, i) => {
  console.log(
    `  ${String(i + 1).padStart(2)}  ${(r.skin * 100).toFixed(1).padStart(4)}  ${(r.center * 100).toFixed(1).padStart(6)}  ${(r.size / 1e6).toFixed(2).padStart(5)}M  ${r.name}`
  );
});

if (copyDest) {
  fs.mkdirSync(copyDest, { recursive: true });
  const picks = rows.filter((r) => r.skin <= threshold);
  for (const r of picks) {
    fs.copyFileSync(path.join(dir, r.name), path.join(copyDest, r.name));
  }
  console.log(`\nCopied ${picks.length} image(s) with skin% <= ${(threshold * 100).toFixed(0)}% to ${copyDest}`);
}
