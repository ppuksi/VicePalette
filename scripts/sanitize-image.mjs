#!/usr/bin/env node
// Strip unwanted metadata chunks from PNG files (e.g. ComfyUI "workflow"
// graphs) while KEEPING generation data chunks ("prompt", "parameters") —
// prompt data stays saved exactly as-is, same chunk structure.
//
// Pure Node, no exiftool. Works on Windows and inside GitHub Actions.
// Only touches the file you point it at — never scans folders, never edits
// the source pipeline files unless you tell it to.
//
// Usage:
//   node scripts/sanitize-image.mjs --in <file.png> [--out <file.png>] [--strip kw1,kw2]
//
// --strip defaults to "workflow" (drop ComfyUI workflow graphs, keep prompts).
// To mimic strip_workflow.bat exactly (also drops prompts): --strip workflow,prompt
//
// Kept chunks are copied verbatim, so per-chunk CRCs stay valid and the image
// data (IDAT) is byte-for-byte untouched.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEXT_TYPES = new Set(['tEXt', 'iTXt', 'zTXt']);

export function sanitizePng(inPath, outPath, { strip = ['workflow'] } = {}) {
  const data = fs.readFileSync(inPath);
  if (!data.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error(`Not a PNG file: ${inPath}`);
  }
  const stripSet = new Set(strip.map((k) => String(k).toLowerCase()));

  const out = [PNG_SIG];
  let off = 8;
  let dropped = 0;
  while (off + 8 <= data.length) {
    const len = data.readUInt32BE(off);
    const type = data.toString('latin1', off + 4, off + 8);
    const chunkStart = off;
    const chunkEnd = off + 12 + len;
    let keep = true;
    if (TEXT_TYPES.has(type)) {
      // Keyword is the first null-terminated field in tEXt/iTXt/zTXt.
      const nul = data.indexOf(0, off + 8);
      const kw = nul === -1 ? '' : data.toString('latin1', off + 8, nul);
      if (stripSet.has(kw.toLowerCase())) {
        keep = false;
        dropped++;
      }
    }
    if (keep) out.push(data.subarray(chunkStart, chunkEnd));
    off = chunkEnd;
  }

  const samePath = path.resolve(inPath) === path.resolve(outPath);
  if (dropped > 0 || !samePath) {
    const result = Buffer.concat(out);
    // Atomic-ish write: temp file then rename, so a crash never leaves a half file.
    const tmp = outPath + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, result);
    fs.renameSync(tmp, outPath);
  }

  return { bytesIn: data.length, bytesOut: dropped > 0 ? Buffer.concat(out).length : data.length, dropped };
}

// ---- CLI ----------------------------------------------------------------
const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const arg = (n, d = null) => {
    const i = args.indexOf(n);
    return i === -1 ? d : args[i + 1];
  };
  const inPath = arg('--in');
  const outPath = arg('--out', inPath);
  const strip = (arg('--strip', 'workflow') || 'workflow')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!inPath || !fs.existsSync(inPath)) {
    console.error('Usage: node scripts/sanitize-image.mjs --in <file.png> [--out <file.png>] [--strip workflow,prompt]');
    process.exit(2);
  }

  const res = sanitizePng(inPath, outPath, { strip });
  console.log(`sanitized: ${path.basename(inPath)}`);
  if (res.dropped > 0) {
    console.log(`  stripped ${res.dropped} chunk(s): ${res.bytesIn} -> ${res.bytesOut} bytes`);
  } else {
    console.log('  no matching chunks found — generation data (prompt/parameters) kept, file unchanged');
  }
}
