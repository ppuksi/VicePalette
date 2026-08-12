#!/usr/bin/env node
// Mark gallery entries as published once their publishAt time has passed.
// Runs on a cron (release-scheduled.yml); only touches entries that are due
// and not yet marked, so the deploy only happens when there is something new.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, '..', 'src', 'content', 'gallery');
const now = Date.now();

let changed = 0;
let due = 0;
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.md')) continue;
  const file = path.join(dir, f);
  let txt = fs.readFileSync(file, 'utf8');
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  if (!m) continue;
  const fm = m[1];
  const get = (k) => {
    const mm = fm.match(new RegExp(`^${k}:\\s*(.+?)\\s*$`, 'm'));
    return mm ? mm[1].trim().replace(/^["']|["']$/g, '') : null;
  };
  if (get('published') === 'true') continue;
  const pa = get('publishAt');
  if (!pa) continue;
  const t = Date.parse(pa);
  if (Number.isNaN(t) || t > now) continue; // not due yet
  due++;
  // insert `published: true` into the frontmatter (before the closing ---)
  const end = txt.indexOf('\n---', txt.indexOf('---\n') + 4);
  if (end === -1) continue;
  txt = txt.slice(0, end) + '\npublished: true' + txt.slice(end);
  fs.writeFileSync(file, txt);
  changed++;
  console.log(`published: ${f} (publishAt ${pa})`);
}

console.log(`due=${due} changed=${changed}`);
