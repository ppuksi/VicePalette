#!/usr/bin/env node
// Inbox worker: scans <root>/inbox for media files and releases each one as a
// gallery entry (title derived from filename).
//
// Local mode (default): media moves into public/gallery/<slug>/ and the entry
// markdown is written. Remote mode (release.config.json has baseUrl + bucket):
// media is uploaded to Backblaze B2 and only entry metadata is written — no
// binaries in the repo. B2 credentials: B2_APPLICATION_KEY_ID /
// B2_APPLICATION_KEY env vars or <root>/.env.local.
//
// After a successful release the source files are MOVED to
// <root>/inbox/.processed/<timestamp>/ (gitignored) and one line per entry is
// appended to <root>/.inbox-log.jsonl for traceability. Nothing is committed —
// the caller (a human or the GitHub Actions workflow) commits.
//
// Optional metadata files next to the media (or at inbox/ root):
//   pipeline.txt     pipeline label, e.g. "krea2"
//   description.txt  gallery description
//   tags.txt         comma-separated tags
//   poster.jpg|png|webp  poster for a video (used as-is; otherwise ffmpeg tries)
//
// Pipeline precedence: --pipeline CLI > <dir>/pipeline.txt > <root>/inbox/pipeline.txt > "unknown"
//
// Usage:
//   node scripts/process-inbox.mjs [--root <repo-root>] [--pipeline <p>] [--dry-run]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseEntry, mediaTypeOf, loadReleaseConfig, loadDotEnvLocal } from './gallery-lib.mjs';

const args = process.argv.slice(2);
function arg(name, def = null) {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(arg('--root', path.join(scriptDir, '..')));
const dryRun = args.includes('--dry-run');
const cliPipeline = arg('--pipeline');

loadDotEnvLocal(root);
const cfg = loadReleaseConfig(root);
const baseUrl = cfg.baseUrl || null;
const bucket = cfg.bucket || null;
const remote = Boolean(baseUrl);

const inbox = path.join(root, 'inbox');
if (!fs.existsSync(inbox)) {
  console.log('No inbox/ directory — nothing to do.');
  process.exit(0);
}

const rootPipelineFile = path.join(inbox, 'pipeline.txt');
const rootPipeline = fs.existsSync(rootPipelineFile)
  ? fs.readFileSync(rootPipelineFile, 'utf8').trim() || null
  : null;

function readOpt(dir, name) {
  const p = path.join(dir, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue; // skip dotfiles / .processed
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const candidates = walk(inbox).filter((f) => mediaTypeOf(f) !== null);
if (candidates.length === 0) {
  console.log('inbox/ has no media files — nothing to release.');
  process.exit(0);
}

console.log(remote ? `Remote mode: uploading to B2 (${bucket}) — baseUrl ${baseUrl}` : 'Local mode: media goes into the repo.');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const processedDir = path.join(inbox, '.processed', stamp);

let released = 0;
for (const file of candidates) {
  const dir = path.dirname(file);
  const pipeline = cliPipeline || readOpt(dir, 'pipeline.txt') || rootPipeline || 'unknown';
  const description = readOpt(dir, 'description.txt') || '';
  const tags = readOpt(dir, 'tags.txt') || '';

  let posterFile = null;
  if (mediaTypeOf(file) === 'video') {
    for (const name of ['poster.jpg', 'poster.jpeg', 'poster.png', 'poster.webp']) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) {
        posterFile = p;
        break;
      }
    }
  }

  if (dryRun) {
    console.log(`[dry-run] would release: ${path.relative(root, file)}  (pipeline: ${pipeline})`);
    continue;
  }

  try {
    const entry = await releaseEntry({
      root,
      mediaFile: file,
      pipeline,
      tags,
      description,
      posterFile,
      baseUrl,
      bucket,
    });

    // Move the source out of the inbox (kept, not deleted, so a failed build
    // never loses art — but nothing is committed until the build validates).
    const moved = path.join(processedDir, path.relative(inbox, file));
    fs.mkdirSync(path.dirname(moved), { recursive: true });
    fs.renameSync(file, moved);

    const logLine = JSON.stringify({
      file: path.relative(inbox, file),
      slug: entry.slug,
      title: entry.title,
      pipeline: entry.pipeline,
      mediaType: entry.mediaType,
      src: entry.src,
      poster: entry.poster || null,
      description: description || '',
      tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      date: entry.date,
      releasedAt: new Date().toISOString(),
    });
    fs.appendFileSync(path.join(root, '.inbox-log.jsonl'), logLine + '\n', 'utf8');

    console.log(`released: ${path.relative(root, file)}  ->  ${entry.slug}  (${entry.remote ? entry.src : 'local'})`);
    released++;
  } catch (err) {
    console.error(`FAILED: ${file} — ${err.message}`);
    process.exitCode = 1;
  }
}

console.log(
  dryRun
    ? `\nDry run: ${candidates.length} inbox file(s) would be released.`
    : `\nDone: ${released} of ${candidates.length} inbox file(s) released.`
);
