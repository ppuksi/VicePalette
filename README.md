# VicePalette

Minimal Astro landing page, built for GitHub Pages.

## Setup

1. `npm install`
2. Edit `astro.config.mjs`:
   - `site`: `https://<your-github-username>.github.io`
   - `base`: `/<repo-name>` — omit this line entirely if the repo is named
     `<your-username>.github.io` (the "root" pages site).
3. Edit `src/pages/index.astro`: copy, the `stack` tags, and the github/email
   links (currently placeholders).
4. `npm run dev` → preview at http://localhost:4321

## Deploy

1. Push this to a GitHub repo.
2. In the repo's **Settings → Pages → Source**, select **GitHub Actions**.
3. Push to `main` — `.github/workflows/deploy.yml` builds and deploys
   automatically. First deploy can take a minute or two to show up.

## Structure

```
src/
  pages/index.astro           the landing page
  pages/gallery/index.astro   gallery grid (pipeline filter, thumbnails)
  pages/gallery/[id].astro    single entry page (image, prompt, params, tags)
  content/gallery/*.md        gallery entries (metadata only — images live on B2)
  content.config.ts           entry schema (title, pipeline, src, thumb, params...)
  layouts/Layout.astro        head/meta wrapper (OG/social tags)
  styles/global.css           design tokens (color, type, spacing) as CSS variables
public/
  favicon.svg                 site icon
scripts/
  release-gallery.mjs         one-shot release CLI (local or B2 remote)
  process-inbox.mjs           inbox worker (releases everything in inbox/)
  sanitize-image.mjs          strip workflow chunks, keep prompt data
  enrich-entries.mjs          backfill prompts/params/thumbnails into entries
  migrate-to-b2.mjs           move local entries to B2 remote hosting
  pick-clothed.mjs            rank images by exposed-skin fraction (ffmpeg)
  b2-upload.mjs               pure-Node Backblaze B2 uploader
.github/workflows/
  deploy.yml                  build + deploy to GitHub Pages
  release-from-inbox.yml      cloud inbox worker (uploads to B2, commits entries)
inbox/                        drop media here to release (see inbox/README.md)
AUTOMATION.md                 full release automation + multi-agent guide
```

## Notes

- All colors/fonts/spacing live as CSS variables at the top of `global.css` —
  change the palette there and it propagates everywhere.
- The hero waveform animates from noise to a resolved signal on load, and
  respects `prefers-reduced-motion` (renders the resolved state directly,
  no animation).
- Entry pages show the generation prompt as the description and settings
  (steps/sampler/cfg/seed/model) as params, extracted automatically from the
  PNG metadata at release time; workflow graphs are stripped before upload.
- Gallery grid loads small JPEG thumbnails (500px) from B2; entry pages load
  the full image.

## Automation

Releasing art to the gallery is scripted and cloud-driven — see
`AUTOMATION.md` for the full guide. Quick versions:

- **Local (agent):** `node scripts/release-gallery.mjs --file <media> --pipeline <p> [--title ".."] [--tags a,b] [--commit] [--push]`
- **From anywhere (PC off):** drop media in `inbox/` — the "Release from inbox"
  GitHub Actions workflow publishes it automatically.
