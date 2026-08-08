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

## Troubleshooting

- Check **Actions** tab: failed runs say why (e.g. schema validation).
- Entries are validated by a real build before commit, so a bad entry never
  lands on the site — inbox files stay put until it's fixed.
- If the schedule stops firing: GitHub pauses scheduled workflows in repos
  without activity for 60 days. Pushing anything (or dispatching manually)
  resumes it.
