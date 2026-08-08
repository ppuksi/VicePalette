# VicePalette release automation

Everything ends the same way: **files on `main`** → GitHub Actions builds →
https://vicepalette.dev updates. You never have to touch GitHub Pages settings.

## Way 1 — Local release (PC on, repo on disk)

One-shot, non-interactive (agent-friendly):

```
node scripts/release-gallery.mjs --file C:\path\to\art.png --pipeline krea2 \
  --title "Neon City" --tags neon,cyberpunk --description "..." --commit --push
```

- `--title` optional (defaults to filename), `--tags` comma-separated,
  `--description` optional, `--poster <path>` optional custom poster.
- `--commit` = stage + commit, `--push` = push (triggers deploy).
- Omit both to just create files for review.
- `--dry-run` prints what would happen.
- Videos get a `poster.jpg` extracted automatically if ffmpeg is installed.

## Way 2 — Inbox drop (works from anywhere, PC can be off)

1. Drop media into `inbox/` (git push, GitHub web upload, or any agent).
2. The **Release from inbox** workflow (`.github/workflows/release-from-inbox.yml`)
   runs in GitHub's cloud:
   - instantly on every push touching `inbox/**`,
   - every 15 minutes as a safety net,
   - on demand: Actions tab → *Release from inbox* → *Run workflow*.
3. It generates entries, validates with a real `astro build`, commits as
   `vicepalette-bot`, and dispatches the Pages deploy.

Optional per-folder metadata: `pipeline.txt`, `description.txt`, `tags.txt`,
`poster.jpg` (see `inbox/README.md`).

## Way 3 — Remote trigger from any agent (REST API)

Any agent (Hermes, a phone script, another machine) can fire a release without
git at all:

```
curl -X POST \
  -H "Authorization: Bearer <PAT>" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/ppuksi/VicePalette/actions/workflows/release-from-inbox.yml/dispatches \
  -d '{"ref":"main","inputs":{"pipeline":"krea2"}}'
```

Or to trigger a plain rebuild/deploy: same call with `deploy.yml`.

An agent can also write files straight into `inbox/` via the Contents API
(`PUT /repos/ppuksi/VicePalette/contents/inbox/<file>` with base64 content) —
a push without git.

## Multi-agent architecture notes (the "smart way")

- **One repo = one shared inbox.** Any agent that can `git push` or call the
  GitHub API can release. Agents never talk to each other or to you — git
  history and `.inbox-log.jsonl` are the coordination layer.
- **Give each agent its own token.** GitHub → Settings → Developer settings →
  *Fine-grained personal access tokens*: repo `ppuksi/VicePalette`, permissions
  `Contents: Read and write`, `Actions: Read and write`. Revoke one agent
  without breaking the others.
- **Cloud timing, not PC timing.** Hermes cron jobs only run while the PC is on.
  Anything that must happen regardless of your PC belongs in GitHub Actions
  (`schedule:` cron) — that's exactly what the inbox worker does.
- **Agents are replaceable.** Because the interface is just "files in a repo",
  you can swap Hermes for another agent (or run several) without touching any
  of this infrastructure.

## B2 remote mode (keep adult content off GitHub)

GitHub Pages is fine for the site *code*, but hosting adult image binaries on
GitHub risks a takedown of the whole site. The clean split:

- **Images → Backblaze B2** (public bucket, adult-content-friendly, 10 GB free).
- **Repo → code + entry metadata only** (markdown with full image URLs).

Setup:

1. Create a **public** bucket in B2 (e.g. `vicepalette-gallery`).
2. Create an application key **scoped to that bucket only** (not account-wide).
3. Fill in `release.config.json`:
   ```json
   { "bucket": "vicepalette-gallery",
     "baseUrl": "https://f002.backblazeb2.com/file/vicepalette-gallery" }
   ```
   (`baseUrl` is what appears before `/gallery/<slug>/<file>` in entry URLs.
   Optionally set up a B2 Friendly URL / custom subdomain and use that instead.)
4. Credentials:
   - **GitHub Actions** (cloud inbox worker): add repo secrets
     `B2_APPLICATION_KEY_ID` and `B2_APPLICATION_KEY`
     (Settings → Secrets and variables → Actions).
   - **Local scripts**: same two names in `.env.local` (gitignored) or env vars.

With `baseUrl` set, `release-gallery.mjs` and `process-inbox.mjs` automatically
switch to remote mode: media is uploaded to B2, entries get full URLs, and no
binaries enter the repo. To move existing local entries over:

```
node scripts/migrate-to-b2.mjs --dry-run   # preview
node scripts/migrate-to-b2.mjs --commit    # upload, rewrite entries, drop binaries
```

## Metadata hygiene (workflow stripping)

ComfyUI PNGs can embed their full node graph in a `workflow` tEXt chunk (and
prompt data in `prompt`/`parameters` chunks). The release pipeline sanitizes
the **staged upload copy** automatically: `workflow` chunks are stripped,
`prompt`/`parameters` generation data is kept byte-for-byte. Your source
pipeline files are never touched.

Standalone tool (same behavior as `C:\Test\AI\strip_workflow.bat`, but keeps
prompts by default):

```
node scripts/sanitize-image.mjs --in file.png                  # strip workflow
node scripts/sanitize-image.mjs --in file.png --strip workflow,prompt   # match strip_workflow.bat
```

Note: if you run `strip_workflow.bat` on source files *before* releasing them,
the prompt data is removed at the source, so it won't be in the gallery copy
either — only run it on files you don't need generation data from.

## LLM titles (optional)

With `"titleFromPrompt": true` in `release.config.json`, entries without a
`.title.txt` get a short title generated from the image's own prompt via an
OpenAI-compatible chat API. Title priority: `title.txt` > LLM-from-prompt >
filename.

- Add an `LLM_API_KEY` secret (Settings → Secrets and variables → Actions) for
  the cloud worker, and/or `LLM_API_KEY=...` in `.env.local` for local runs.
- Env: `LLM_MODEL` (default `deepseek-chat`), `LLM_BASE_URL` (default
  `https://api.deepseek.com`). Any OpenAI-compatible endpoint works.
- The call is cheap (~200 tokens/image) and fails safe: no key / error → falls
  back to filename-derived titles.
- Backfill titles for existing entries (once the key is set):
  `node scripts/enrich-entries.mjs --src-dir <folder> --titles --commit`

## Troubleshooting

- Check **Actions** tab: failed runs say why (e.g. schema validation).
- Entries are validated by a real build before commit, so a bad entry never
  lands on the site — inbox files stay put until it's fixed.
- If the schedule stops firing: GitHub pauses scheduled workflows in repos
  without activity for 60 days. Pushing anything (or dispatching manually)
  resumes it.
