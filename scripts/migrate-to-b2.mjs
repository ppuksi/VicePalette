#!/usr/bin/env node
// Migrate existing LOCAL gallery entries to B2 remote mode:
//   - uploads every file in public/gallery/<slug>/ to the B2 bucket
//   - rewrites src/poster in the entry markdown to full B2 URLs
//   - removes the binaries from the repo (metadata-only repo afterwards)
//
// Requires release.config.json (bucket + baseUrl) and B2 credentials
// (B2_APPLICATION_KEY_ID / B2_APPLICATION_KEY env vars or .env.local).
//
// Usage:
//   node scripts/migrate-to-b2.mjs [--dry-run] [--commit]
//
// --dry-run shows what would be uploaded/rewritten without touching anything.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { b2UploadFile } from './b2-upload.mjs';
import { loadReleaseConfig, loadDotEnvLocal } from './gallery-lib.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const commit = args.includes('--commit');
function arg(name, def = null) {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(arg('--root', path.join(scriptDir, '..')));

loadDotEnvLocal(root);
const cfg = loadReleaseConfig(root);
const { bucket, baseUrl } = cfg;

if (!bucket || !baseUrl) {
  console.error('release.config.json must set "bucket" and "baseUrl" (see AUTOMATION.md).');
  process.exit(2);
}
const keyId = process.env.B2_APPLICATION_KEY_ID;
const appKey = process.env.B2_APPLICATION_KEY;
if (!keyId || !appKey) {
  console.error('B2 credentials missing: set B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY (env or .env.local).');
  process.exit(2);
}

const mdDir = path.join(root, 'src', 'content', 'gallery');
const galleryDir = path.join(root, 'public', 'gallery');
if (!fs.existsSync(mdDir)) {
  console.error(`No entries found at ${mdDir}`);
  process.exit(2);
}

const rewriteLine = (line) =>
  line.replace(/^(\s*(?:src|poster):\s*)"\/gallery\//, `$1"${baseUrl}/gallery/`);

const entries = fs.readdirSync(mdDir).filter((f) => f.endsWith('.md')).sort();
let migrated = 0;
let skipped = 0;

for (const mdFile of entries) {
  const mdPath = path.join(mdDir, mdFile);
  const lines = fs.readFileSync(mdPath, 'utf8').split(/\r?\n/);
  const srcLine = lines.find((l) => /^\s*src:\s*"/.test(l));
  if (!srcLine || !/\/gallery\//.test(srcLine)) {
    skipped++; // already remote or malformed — leave alone
    continue;
  }

  const slug = mdFile.replace(/\.md$/, '');
  const mediaDir = path.join(galleryDir, slug);
  if (!fs.existsSync(mediaDir)) {
    console.error(`skip ${slug}: media folder missing (${mediaDir})`);
    skipped++;
    continue;
  }

  const files = fs.readdirSync(mediaDir);
  console.log(`\n${slug}: ${files.length} file(s) -> b2://${bucket}/gallery/${slug}/`);
  for (const f of files) {
    const localPath = path.join(mediaDir, f);
    const remotePath = `gallery/${slug}/${f}`;
    console.log(`  upload ${f}`);
    if (!dryRun) {
      await b2UploadFile({ keyId, appKey, bucketName: bucket, localPath, remotePath });
    }
  }

  if (!dryRun) {
    const newLines = lines.map(rewriteLine);
    fs.writeFileSync(mdPath, newLines.join('\n'), 'utf8');
    fs.rmSync(mediaDir, { recursive: true, force: true });
    console.log(`  rewrote ${mdFile}, removed public/gallery/${slug}/`);
  }
  migrated++;
}

console.log(`\n${dryRun ? 'Dry run' : 'Done'}: ${migrated} migrated, ${skipped} skipped (already remote or missing).`);

if (!dryRun && commit && migrated > 0) {
  execSync(`git add -A -- "${mdDir}" "${galleryDir}"`, { cwd: root, stdio: 'inherit' });
  execSync(`git commit -m "migrate gallery to B2 remote hosting"`, { cwd: root, stdio: 'inherit' });
  console.log('Committed.');
}
