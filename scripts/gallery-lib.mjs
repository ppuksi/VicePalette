// Shared helpers for releasing gallery entries into the VicePalette repo.
// Used by release-gallery.mjs (one-shot CLI) and process-inbox.mjs (inbox worker).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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

/**
 * Copy a media file into public/gallery/<slug>/ and write the markdown entry.
 * Returns { slug, mediaDir, mdPath, src, poster, title, pipeline, mediaType, date }.
 */
export function releaseEntry({
  root,
  mediaFile,
  title = null,
  pipeline,
  tags = '',
  description = '',
  posterFile = null, // pre-existing poster image to copy in (used before ffmpeg)
}) {
  const mediaPath = path.resolve(mediaFile);
  if (!fs.existsSync(mediaPath)) throw new Error(`File not found: ${mediaFile}`);
  const mediaType = mediaTypeOf(mediaPath);
  if (!mediaType) throw new Error(`Unsupported media type: ${path.basename(mediaPath)}`);

  const finalTitle = title || titleFromFilename(path.basename(mediaPath));
  const slug = uniqueSlug(root, slugify(finalTitle));
  const mediaDir = path.join(root, 'public', 'gallery', slug);
  fs.mkdirSync(mediaDir, { recursive: true });

  const fileName = path.basename(mediaPath);
  const destFile = path.join(mediaDir, fileName);
  fs.copyFileSync(mediaPath, destFile);

  let poster = null;
  if (posterFile && fs.existsSync(posterFile)) {
    const posterName = path.basename(posterFile);
    fs.copyFileSync(posterFile, path.join(mediaDir, posterName));
    poster = `/gallery/${slug}/${posterName}`;
  } else if (mediaType === 'video') {
    const generated = path.join(mediaDir, 'poster.jpg');
    if (makePosterFromVideo(destFile, generated)) {
      poster = `/gallery/${slug}/poster.jpg`;
    }
  }

  const src = `/gallery/${slug}/${fileName}`;
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

  return { slug, mediaDir, mdPath, src, poster, title: finalTitle, pipeline, mediaType, date };
}
