# 📥 Gallery inbox

Drop media files (or folders) in here and they get released to the gallery
automatically — no git commands needed.

## How to use

1. Put your image/video here. You can push it with git, upload it via the
   GitHub web UI (Add file → Upload files), or have any agent push it for you.
2. That's it. Release happens within ~15 minutes (or instantly if you pushed
   the file yourself — the push itself triggers the release workflow).

Optional metadata — drop a text file next to your media:

| File              | Purpose                                  | Example            |
| ----------------- | ---------------------------------------- | ------------------ |
| `pipeline.txt`    | Pipeline label (applies to this folder)  | `krea2`            |
| `description.txt` | Gallery description                      | `Neon city study`  |
| `tags.txt`        | Comma-separated tags                     | `neon, cityscape`  |
| `poster.jpg`      | Poster for a video (else ffmpeg makes it)| —                  |

Put `pipeline.txt` at the **root of inbox/** to set a default for everything.

## What happens

1. GitHub Actions runs `scripts/process-inbox.mjs` (every 15 min, on every
   inbox push, or manually via Actions → "Release from inbox").
2. Each media file becomes a gallery entry (title from filename).
3. The site is built to validate the entries, then committed & deployed to
   https://vicepalette.dev — even if your PC is off.
4. Processed files move to `inbox/.processed/` and get logged in
   `.inbox-log.jsonl` at the repo root.

See `AUTOMATION.md` at the repo root for the full story.
