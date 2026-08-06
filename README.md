# pasi-site

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
  pages/index.astro      the page content
  layouts/Layout.astro   head/meta wrapper
  styles/global.css      design tokens (color, type, spacing) as CSS variables
public/
  favicon.svg            site icon
```

## Notes

- All colors/fonts/spacing live as CSS variables at the top of `global.css` —
  change the palette there and it propagates everywhere.
- The hero waveform animates from noise to a resolved signal on load, and
  respects `prefers-reduced-motion` (renders the resolved state directly,
  no animation).
- No JS framework, no build-time dependencies beyond Astro itself — this
  should stay a fast, cheap static build indefinitely.
