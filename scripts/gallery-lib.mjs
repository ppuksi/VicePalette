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
}) {
  const mediaPath = path.resolve(mediaFile);
  if (!fs.existsSync(mediaPath)) throw new Error(`File not found: ${mediaFile}`);
  const mediaType = mediaTypeOf(mediaPath);
  if (!mediaType) throw new Error(`Unsupported media type: ${path.basename(mediaPath)}`);

  const remote = Boolean(baseUrl);
  const finalTitle = title || titleFromFilename(path.basename(mediaPath));
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
  if (poster) lines.push(`poster: "${yamlStr(poster)}"`);
  lines.push(`description: "${yamlStr(description)}"`);
  lines.push('# params:');
  lines.push('#   sampler: ""');
  lines.push('#   cfg: ""');
  lines.push('#   steps: ""');
  lines.push('#   seed: ""');
  const tagList = [...new Set(parseTags(tags))];
  lines.push(`tags: [${tagList.map((t) => `"${yamlStr(t)}"`).join(', ')}]`);
  lines.push('---', '', '');

  fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');

  return { slug, mediaDir, mdPath, src, poster, title: finalTitle, pipeline, mediaType, date, remote, sanitized };
}
