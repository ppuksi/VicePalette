// Shared helpers for releasing gallery entries into the VicePalette repo.
// Used by release-gallery.mjs (one-shot CLI), process-inbox.mjs (inbox worker)
// and migrate-to-b2.mjs (moving existing entries to remote hosting).
//
// Two modes:
//   local  (default)  media copied into public/gallery/<slug>/, src is a site path
//   remote (B2)       media uploaded to a Backblaze B2 bucket, src is a full URL;
//                     nothing binary is committed to the repo (adult-safe hosting)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { b2UploadFile } from './b2-upload.mjs';
import { sanitizePng } from './sanitize-image.mjs';

export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
export const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv']);

export function mediaTypeOf(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
}

export function slugify(text) {
  const slug = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

// Quote a value for a YAML double-quoted string, newlines collapsed.
export function yamlStr(value) {
  return String(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Resolve a slug that doesn't collide with existing folders/entries.
export function uniqueSlug(root, baseSlug) {
  let slug = baseSlug;
  let i = 2;
  while (
    fs.existsSync(path.join(root, 'public', 'gallery', slug)) ||
    fs.existsSync(path.join(root, 'src', 'content', 'gallery', `${slug}.md`))
  ) {
    slug = `${baseSlug}-${i++}`;
  }
  return slug;
}

export function titleFromFilename(fileName) {
  const base = path.basename(fileName, path.extname(fileName));
  return base.replace(/[_\-]+/g, ' ').trim() || 'Untitled';
}

export function parseTags(raw) {
  return String(raw || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

// Extract a poster frame at 1s from a video. Returns true on success.
export function makePosterFromVideo(videoPath, posterPath) {
  const res = spawnSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-i', videoPath, '-ss', '00:00:01', '-vframes', '1', posterPath],
    { stdio: 'ignore', timeout: 60000 }
  );
  return res.status === 0 && fs.existsSync(posterPath);
}

// ---- generation data extraction (from PNG tEXt chunks) ---------------------

function readTextChunk(pngPath, keyword) {
  const b = fs.readFileSync(pngPath);
  if (!b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null;
  let off = 8;
  while (off + 8 <= b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('latin1', off + 4, off + 8);
    if (type === 'tEXt') {
      const nul = b.indexOf(0, off + 8);
      if (nul !== -1 && b.toString('latin1', off + 8, nul) === keyword) {
        return b.subarray(nul + 1, off + 8 + len).toString('latin1');
      }
    }
    off += 12 + len;
  }
  return null;
}

// Pull the human-readable positive prompt + generation settings out of a PNG's
// metadata ("parameters" chunk, falling back to the ComfyUI "prompt" graph).
export function extractGenerationData(pngPath) {
  const out = { prompt: null, params: {} };

  const parameters = readTextChunk(pngPath, 'parameters');
  if (parameters) {
    const lines = parameters.split(/\r?\n/);
    const first = (lines[0] || '').trim();
    if (first && first.toLowerCase() !== 'unknown') out.prompt = first;
    const settings = lines.find((l) => /^Steps:/i.test(l)) || '';
    const map = {
      steps: 'Steps',
      sampler: 'Sampler',
      cfg: 'CFG scale',
      seed: 'Seed',
      size: 'Size',
      model: 'Model',
      version: 'Version',
    };
    for (const [k, label] of Object.entries(map)) {
      const m = settings.match(new RegExp(label + ':\\s*([^,]+)'));
      if (m) out.params[k] = m[1].trim();
    }
  }

  if (!out.prompt) {
    const graph = readTextChunk(pngPath, 'prompt');
    if (graph) {
      try {
        const j = JSON.parse(graph);
        const texts = [];
        const walk = (o) => {
          if (typeof o === 'string') return;
          if (Array.isArray(o)) { o.forEach(walk); return; }
          if (o && typeof o === 'object') {
            for (const k of Object.keys(o)) {
              if (/^text$/i.test(k) && typeof o[k] === 'string' && o[k].length > 20 && !o[k].includes('\\')) {
                texts.push(o[k].trim());
              } else {
                walk(o[k]);
              }
            }
          }
        };
        walk(j);
        if (texts.length) out.prompt = texts.sort((a, b) => b.length - a.length)[0];
      } catch { /* not JSON — ignore */ }
    }
  }

  if (out.prompt) out.prompt = out.prompt.replace(/\s+/g, ' ').trim();
  return out;
}

// Pull the full H3-style prompt + settings for a VIDEO from its paired frame
// PNG (same basename, .png next to the .mp4). Videos themselves carry no
// readable prompt chunk; the frame PNG written beside each clip does.
export function extractVideoGenerationData(videoPath) {
  const out = { prompt: null, params: {} };
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  let pngPath = path.join(dir, base + '.png');
  if (!fs.existsSync(pngPath)) {
    const candidates = fs.readdirSync(dir).filter((f) => f.startsWith(base) && f.endsWith('.png'));
    if (candidates.length) pngPath = path.join(dir, candidates.sort().pop());
    else return out;
  }
  const parameters = readTextChunk(pngPath, 'parameters');
  if (!parameters) return out;
  out.prompt = parameters.replace(/\s+/g, ' ').trim();
  const settings = parameters.split(/\r?\n/).find((l) => /^Steps:/i.test(l)) || '';
  const map = {
    steps: 'Steps',
    sampler: 'Sampler',
    cfg: 'CFG scale',
    seed: 'Seed',
    size: 'Size',
    model: 'Model',
  };
  for (const [k, label] of Object.entries(map)) {
    const m = settings.match(new RegExp(label + ':\\s*([^,]+)'));
    if (m) out.params[k] = m[1].trim();
  }
  return out;
}


// Generate a small JPEG thumbnail (~500px wide) with ffmpeg. True on success.
export function makeThumb(sourcePath, thumbPath) {
  const res = spawnSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-i', sourcePath, '-vf', 'scale=500:-1', '-q:v', '4', thumbPath],
    { stdio: 'ignore', timeout: 60000 }
  );
  return res.status === 0 && fs.existsSync(thumbPath);
}

// Ask an LLM (OpenAI-compatible chat API) for a short gallery title for a
// prompt. Returns null on any failure (missing key, network, bad response) —
// callers fall back to filename-derived titles.
//
// Env:
//   LLM_API_KEY    API key (required)
//   LLM_MODEL      default "deepseek-chat"
//   LLM_BASE_URL   default "https://api.deepseek.com" (OpenAI-compatible)
//   LLM_API_BASE   test override for the base URL (takes precedence)
export async function llmTitleFromPrompt(prompt) {
  const key = process.env.LLM_API_KEY;
  if (!key) return null;
  const base = process.env.LLM_API_BASE || process.env.LLM_BASE_URL || 'https://api.deepseek.com';
  const model = process.env.LLM_MODEL || 'deepseek-chat';
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are a curator naming AI-generated images for an art gallery. ' +
              'Reply with ONLY a short evocative title, max 6 words, no quotes, no trailing punctuation.',
          },
          { role: 'user', content: String(prompt).slice(0, 2000) },
        ],
        temperature: 0.7,
        max_tokens: 24,
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const t = j.choices?.[0]?.message?.content?.trim();
    if (!t) return null;
    return t.replace(/^["']+|["']+$/g, '').replace(/\s+/g, ' ').trim();
  } catch {
    return null;
  }
}

// ---- release config -------------------------------------------------------

export function loadReleaseConfig(root) {
  const p = path.join(root, 'release.config.json');
  const def = { bucket: '', baseUrl: '' };
  if (!fs.existsSync(p)) return def;
  try {
    return { ...def, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch {
    return def;
  }
}

// Load KEY=VALUE lines from <root>/.env.local into process.env (never overrides
// already-set env vars). For local B2 credentials.
export function loadDotEnvLocal(root) {
  const p = path.join(root, '.env.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

// ---- release --------------------------------------------------------------

/**
 * Release a media file as a gallery entry.
 *
 * local mode:  copies media into public/gallery/<slug>/ (committed to the repo)
 * remote mode: uploads media to B2 and writes only the entry markdown, with
 *              `src`/`poster` as full URLs (baseUrl + path). Media is staged in
 *              <root>/.local-media/ (gitignored) for poster extraction.
 *
 * Returns { slug, mediaDir, mdPath, src, poster, title, pipeline, mediaType, date, remote }.
 */
export async function releaseEntry({
  root,
  mediaFile,
  title = null,
  pipeline,
  tags = '',
  description = '',
  posterFile = null, // pre-existing poster image to use (copied/uploaded)
  baseUrl = null,
  bucket = null,
  titleFromPrompt = false, // ask the LLM for a title when no explicit title given
}) {
  const mediaPath = path.resolve(mediaFile);
  if (!fs.existsSync(mediaPath)) throw new Error(`File not found: ${mediaFile}`);
  const mediaType = mediaTypeOf(mediaPath);
  if (!mediaType) throw new Error(`Unsupported media type: ${path.basename(mediaPath)}`);

  const remote = Boolean(baseUrl);

  // Generation data (read from the source file — prompt/parameters chunks
  // survive sanitization unchanged; only "workflow" is stripped later).
  let genPrompt = null;
  let genParams = null;
  if (mediaType === 'image') {
    const gen = extractGenerationData(mediaPath);
    genPrompt = gen.prompt;
    genParams = Object.keys(gen.params).length ? gen.params : null;
  } else if (mediaType === 'video') {
    const gen = extractVideoGenerationData(mediaPath);
    genPrompt = gen.prompt;
    genParams = Object.keys(gen.params).length ? gen.params : null;
  }
  const finalDescription = (description || genPrompt || '').trim();

  // Title priority: explicit title > LLM title from prompt > filename.
  let finalTitle =
    title ||
    (titleFromPrompt && genPrompt ? await llmTitleFromPrompt(genPrompt) : null) ||
    titleFromFilename(path.basename(mediaPath));
  const slug = uniqueSlug(root, slugify(finalTitle));

  // Stage dir: committed (public/) in local mode, gitignored (.local-media/) in remote mode.
  const mediaDir = remote
    ? path.join(root, '.local-media', slug)
    : path.join(root, 'public', 'gallery', slug);
  fs.mkdirSync(mediaDir, { recursive: true });

  const fileName = path.basename(mediaPath);
  const destFile = path.join(mediaDir, fileName);
  fs.copyFileSync(mediaPath, destFile);

  // Sanitize the staged copy BEFORE it can reach the repo or B2: drop ComfyUI
  // "workflow" graphs, keep generation data ("prompt"/"parameters" chunks).
  // Only PNGs carry these chunks; the source file is never touched.
  let sanitized = 0;
  if (mediaType === 'image' && path.extname(destFile).toLowerCase() === '.png') {
    const res = sanitizePng(destFile, destFile, { strip: ['workflow'] });
    sanitized = res.dropped;
  }

  // Grid thumbnail (images only; videos already get a poster).
  let thumb = null;
  let thumbLocal = null;
  if (mediaType === 'image') {
    const tPath = path.join(mediaDir, 'thumb.jpg');
    if (makeThumb(destFile, tPath)) {
      thumbLocal = tPath;
      thumb = `${remote ? baseUrl : ''}/gallery/${slug}/thumb.jpg`;
    }
  }

  let poster = null;
  let posterLocal = null;
  if (posterFile && fs.existsSync(posterFile)) {
    const posterName = path.basename(posterFile);
    posterLocal = path.join(mediaDir, posterName);
    fs.copyFileSync(posterFile, posterLocal);
    poster = `${remote ? baseUrl : ''}/gallery/${slug}/${posterName}`;
  } else if (mediaType === 'video') {
    const generated = path.join(mediaDir, 'poster.jpg');
    if (makePosterFromVideo(destFile, generated)) {
      posterLocal = generated;
      poster = `${remote ? baseUrl : ''}/gallery/${slug}/poster.jpg`;
    }
  }

  if (remote) {
    if (!bucket) {
      throw new Error('Remote mode needs a bucket: set "bucket" in release.config.json or pass --bucket');
    }
    const keyId = process.env.B2_APPLICATION_KEY_ID;
    const appKey = process.env.B2_APPLICATION_KEY;
    if (!keyId || !appKey) {
      throw new Error(
        'B2 credentials missing. Set B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY ' +
          '(env vars or .env.local) — see AUTOMATION.md.'
      );
    }
    await b2UploadFile({
      keyId,
      appKey,
      bucketName: bucket,
      localPath: destFile,
      remotePath: `gallery/${slug}/${fileName}`,
    });
    if (posterLocal) {
      await b2UploadFile({
        keyId,
        appKey,
        bucketName: bucket,
        localPath: posterLocal,
        remotePath: `gallery/${slug}/${path.basename(posterLocal)}`,
      });
    }
    if (thumbLocal) {
      await b2UploadFile({
        keyId,
        appKey,
        bucketName: bucket,
        localPath: thumbLocal,
        remotePath: `gallery/${slug}/thumb.jpg`,
      });
    }
  }

  const src = remote
    ? `${baseUrl}/gallery/${slug}/${fileName}`
    : `/gallery/${slug}/${fileName}`;
  const date = today();
  const mdPath = path.join(root, 'src', 'content', 'gallery', `${slug}.md`);

  const lines = [
    '---',
    `title: "${yamlStr(finalTitle)}"`,
    `pipeline: "${yamlStr(pipeline)}"`,
    `date: ${date}`,
    `mediaType: "${mediaType}"`,
    `src: "${yamlStr(src)}"`,
  ];
  if (thumb) lines.push(`thumb: "${yamlStr(thumb)}"`);
  if (poster) lines.push(`poster: "${yamlStr(poster)}"`);
  lines.push(`description: "${yamlStr(finalDescription)}"`);
  if (genParams) {
    lines.push('params:');
    for (const [k, v] of Object.entries(genParams)) lines.push(`  ${k}: "${yamlStr(v)}"`);
  } else {
    lines.push('# params:');
    lines.push('#   sampler: ""');
    lines.push('#   cfg: ""');
    lines.push('#   steps: ""');
    lines.push('#   seed: ""');
  }
  const tagList = [...new Set(parseTags(tags))];
  lines.push(`tags: [${tagList.map((t) => `"${yamlStr(t)}"`).join(', ')}]`);
  lines.push('---', '', '');

  fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');

  return {
    slug,
    mediaDir,
    mdPath,
    src,
    thumb,
    poster,
    title: finalTitle,
    description: finalDescription,
    pipeline,
    mediaType,
    date,
    remote,
    sanitized,
  };
}
