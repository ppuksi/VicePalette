#!/usr/bin/env node
// One-shot gallery release for agents. Non-interactive.
//
// Usage:
//   node scripts/release-gallery.mjs --file <media> --pipeline <pipeline> \
//     [--title "Title"] [--tags a,b,c] [--description "..."] [--poster <path>] \
//     [--root <repo-root>] [--commit] [--push] [--dry-run]
//
// Modes:
//   local  (default)  media is copied into the repo (public/gallery/<slug>/)
//   remote (B2)       media is uploaded to Backblaze B2; only entry metadata is
//                     committed. Set "bucket"/"baseUrl" in release.config.json
//                     (or --bucket/--base-url) and B2_APPLICATION_KEY_ID /
//                     B2_APPLICATION_KEY in the environment or .env.local.
//
// Examples:
//   node scripts/release-gallery.mjs --file C:\Users\Pasi\Pictures\art.png \
//     --title "Neon City" --pipeline krea2 --tags neon,cyberpunk --commit --push
//
// --commit stages+commits the new entry, --push also pushes (triggers the
// GitHub Pages deploy). Omit both to just create files locally.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { releaseEntry, loadReleaseConfig, loadDotEnvLocal } from './gallery-lib.mjs';

const args = process.argv.slice(2);
function arg(name, def = null) {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
}
const has = (name) => args.includes(name);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(arg('--root', path.join(scriptDir, '..')));

const file = arg('--file');
const pipeline = arg('--pipeline');
const dryRun = has('--dry-run');

if (!file) {
  console.error('Missing --file <path>');
  process.exit(2);
}
if (!pipeline) {
  console.error('Missing --pipeline (e.g. krea2, ltx-2.3, wan-2.2)');
  process.exit(2);
}

loadDotEnvLocal(root);
const cfg = loadReleaseConfig(root);
const baseUrl = arg('--base-url', cfg.baseUrl || null);
const bucket = arg('--bucket', cfg.bucket || null);

if (dryRun) {
  console.log(`[dry-run] root=${root}`);
  console.log(`[dry-run] file=${file}`);
  console.log(`[dry-run] pipeline=${pipeline}`);
  console.log(`[dry-run] title=${arg('--title') || '(from filename)'}`);
  console.log(`[dry-run] mode=${baseUrl ? `remote (B2, baseUrl=${baseUrl}, bucket=${bucket || 'MISSING'})` : 'local'}`);
  if (has('--commit')) console.log('[dry-run] would git add + commit');
  if (has('--push')) console.log('[dry-run] would git push');
  process.exit(0);
}

const entry = await releaseEntry({
  root,
  mediaFile: file,
  title: arg('--title'),
  pipeline,
  tags: arg('--tags'),
  description: arg('--description') || '',
  posterFile: arg('--poster'),
  baseUrl,
  bucket,
});

console.log('');
console.log(`Released (${entry.remote ? 'remote → B2' : 'local → repo'}):`);
console.log(`  title      ${entry.title}`);
console.log(`  pipeline   ${entry.pipeline}`);
console.log(`  slug       ${entry.slug}`);
console.log(`  mediaType  ${entry.mediaType}`);
console.log(`  media      ${entry.src}`);
if (entry.poster) console.log(`  poster     ${entry.poster}`);
console.log(`  entry md   ${entry.mdPath}`);

if (has('--commit')) {
  // In remote mode the media lives in .local-media/ (gitignored) — only the
  // entry markdown goes into the commit.
  const addPaths = entry.remote ? [entry.mdPath] : [entry.mediaDir, entry.mdPath];
  execSync(`git add -- ${addPaths.map((p) => `"${p}"`).join(' ')}`, { cwd: root, stdio: 'inherit' });
  execSync(`git commit -m "release: ${entry.title}"`, { cwd: root, stdio: 'inherit' });
  console.log('Committed.');
}
if (has('--push')) {
  execSync('git push', { cwd: root, stdio: 'inherit' });
  console.log('Pushed — GitHub Pages deploy triggered.');
}
