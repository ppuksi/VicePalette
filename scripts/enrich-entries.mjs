#!/usr/bin/env node
// Backfill existing gallery entries with generation data + grid thumbnails:
//   - prompt from PNG metadata -> entry description (if currently empty)
//   - settings (steps/sampler/cfg/seed/size/model) -> entry params
//   - 500px JPEG thumbnail -> uploaded to B2, entry gets a `thumb` field
//
// Source images are matched by filename (from the entry's src) inside --src-dir.
// Only remote (B2) entries are processed.
//
// Usage:
//   node scripts/enrich-entries.mjs --src-dir <folder> [--dry-run] [--commit] [--root <repo>]

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { b2UploadFile } from './b2-upload.mjs';
import {
  loadReleaseConfig,
  loadDotEnvLocal,
  extractGenerationData,
  makeThumb,
  yamlStr,
} from './gallery-lib.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const commit = args.includes('--commit');
function arg(name, def = null) {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
}

const srcDir = arg('--src-dir');
if (!srcDir || !fs.existsSync(srcDir)) {
  console.error('Usage: node scripts/enrich-entries.mjs --src-dir <folder> [--dry-run] [--commit]');
  process.exit(2);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(arg('--root', path.join(scriptDir, '..')));

loadDotEnvLocal(root);
const cfg = loadReleaseConfig(root);
const { bucket, baseUrl } = cfg;
const remote = Boolean(baseUrl);

const keyId = process.env.B2_APPLICATION_KEY_ID;
const appKey = process.env.B2_APPLICATION_KEY;
if (remote && (!keyId || !appKey)) {
  console.error('B2 credentials missing: set B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY (env or .env.local).');
  process.exit(2);
}

const mdDir = path.join(root, 'src', 'content', 'gallery');
const tmpDir = path.join(root, '.local-media', 'enrich');
fs.mkdirSync(tmpDir, { recursive: true });

const entries = fs.readdirSync(mdDir).filter((f) => f.endsWith('.md')).sort();
let enriched = 0;
let skipped = 0;

for (const mdFile of entries) {
  const mdPath = path.join(mdDir, mdFile);
  const lines = fs.readFileSync(mdPath, 'utf8').split(/\r?\n/);

  const srcLine = lines.find((l) => /^\s*src:\s*"/.test(l));
  const srcVal = srcLine ? (srcLine.match(/"([^"]+)"/) || [])[1] : null;
  if (!srcVal || !/^http/.test(srcVal)) {
    skipped++;
    continue;
  }
  const fileName = srcVal.split('/').pop();
  const localSource = path.join(srcDir, fileName);
  if (!fs.existsSync(localSource)) {
    console.error(`skip ${mdFile}: source not found (${localSource})`);
    skipped++;
    continue;
  }

  const slug = mdFile.replace(/\.md$/, '');
  const gen = extractGenerationData(localSource);
  const changed = [];

  // 1) description = prompt (only if currently empty)
  const descIdx = lines.findIndex((l) => /^\s*description:\s*"/.test(l));
  if (gen.prompt && descIdx !== -1) {
    const current = (lines[descIdx].match(/"([^"]*)"/) || [])[1] || '';
    if (!current.trim()) {
      if (!dryRun) lines[descIdx] = `description: "${yamlStr(gen.prompt)}"`;
      changed.push('description');
    }
  }

  // 2) params block (replace the commented placeholder if present)
  const hasParams = lines.some((l) => /^\s*params:/.test(l) && !l.trim().startsWith('#'));
  if (!hasParams && gen.params && Object.keys(gen.params).length) {
    const commentIdx = lines.findIndex((l) => /^\s*# params:/.test(l));
    if (commentIdx !== -1) {
      let end = commentIdx + 1;
      while (end < lines.length && /^\s*#/.test(lines[end])) end++;
      if (!dryRun) {
        const block = ['params:'];
        for (const [k, v] of Object.entries(gen.params)) block.push(`  ${k}: "${yamlStr(v)}"`);
        lines.splice(commentIdx, end - commentIdx, ...block);
      }
      changed.push('params');
    }
  }

  // 3) thumbnail: generate + upload, add thumb field after src
  const hasThumb = lines.some((l) => /^\s*thumb:/.test(l));
  if (!hasThumb) {
    const srcIdx = lines.findIndex((l) => /^\s*src:\s*"/.test(l));
    const thumbLocal = path.join(tmpDir, `${slug}.jpg`);
    if (makeThumb(localSource, thumbLocal)) {
      if (remote) {
        if (!dryRun) {
          await b2UploadFile({
            keyId,
            appKey,
            bucketName: bucket,
            localPath: thumbLocal,
            remotePath: `gallery/${slug}/thumb.jpg`,
          });
        }
        if (srcIdx !== -1 && !dryRun) {
          lines.splice(srcIdx + 1, 0, `thumb: "${yamlStr(`${baseUrl}/gallery/${slug}/thumb.jpg`)}"`);
        }
        changed.push('thumb');
      } else {
        console.warn(`skip thumb for ${mdFile}: not a remote entry`);
      }
    } else {
      console.warn(`thumb generation failed for ${mdFile}`);
    }
  }

  if (changed.length) {
    if (!dryRun) fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
    console.log(`${dryRun ? '[dry-run] would enrich' : 'enriched'}: ${mdFile} (${changed.join(', ')})`);
    enriched++;
  } else {
    skipped++;
  }
}

console.log(`\n${dryRun ? 'Dry run' : 'Done'}: ${enriched} enriched, ${skipped} skipped.`);

if (!dryRun && commit && enriched > 0) {
  execSync(`git add -A -- "${mdDir}"`, { cwd: root, stdio: 'inherit' });
  execSync(`git commit -m "enrich gallery entries: prompts, params, thumbnails"`, { cwd: root, stdio: 'inherit' });
  console.log('Committed.');
}
