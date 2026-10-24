# Film production with OpenReel

This fork turns OpenReel into a production desk for AI-generated films: a
Fountain screenplay becomes a shot list on the timeline, every shot is
prompted on Kling or Higgsfield, downloaded takes land in a project folder
under one naming pattern, and the cut is conformed, dialogue-assembled and
exported as an EDL.

Design history and the reasoning behind each choice:
[`docs/superpowers/plans/2026-10-24-ai-film-production-pipeline.md`](superpowers/plans/2026-10-24-ai-film-production-pipeline.md).

## The loop at a glance

1. **Write** the script in Fountain (`.fountain`).
2. **Import** it in the editor (rail button *Import script*) or with
   `prod.mjs init`. Each scene becomes a marker and each shot a placeholder
   clip on the `SHOTS` track, sized by the estimated length.
3. **Name references**: drop Kling / Higgsfield reference downloads into
   `refs/_inbox/` and run `prod.mjs name-refs`, then `--apply`.
4. **Register entities** (characters, locations, props) with their Kling
   element id and Higgsfield element / Soul id.
5. **Prompt** every shot on the *Shot Board*: choose a generator, write the
   prompt, check the reference limits.
6. **Generate** on the platform (by hand, by MCP from Claude Code, or with the
   platform CLI) and **record** the generation id against the shot.
7. **Download** the finished take; it is renamed to the shot's take name.
8. **Review** takes with the local vision model (optional score + trim).
9. **Select** the take per shot; the Shot Board's folder sync links the files.
10. **Conform to takes** → **Check dialogue** → **Assemble audio** → **EDL**.

## Project folder

```
<project>/
  production.json          shared record: entities, shots, prompts, takes
  script.fountain
  refs/
    _inbox/                new references waiting to be named
    CHR/<CODE>/<CODE>_01.png
    LOC/<CODE>/...
    PRP/<CODE>/...
    VOX/<CODE>/...
  shots/
    S001/<PROJ>_S001_SH01_<modeltag>_T01.mp4
```

The browser and the CLI both read and write `production.json`; the Shot
Board's folder sync (*Connect folder*, then *Sync <name>*; it also re-syncs every 10 s while open) merges both ways, so either side can be used.

## Naming pattern

| Thing | Pattern | Example |
|---|---|---|
| Entity | `<PROJ>-<KIND>-<SLUG>` (≤ 32 chars, KIND = CHR/LOC/PRP/VOX) | `TH-CHR-MARA` |
| Shot | `<PROJ>_S###_SH##` | `TH_S001_SH01` |
| Take file | `<shot>_<modeltag>_T##.<ext>` | `TH_S001_SH01_kl-v4_T02.mp4` |
| Higgsfield folder | `<PROJ>/S###/SH##` | `TH/S001/SH01` |

Use the entity code as the element name on both Kling and Higgsfield. The
platforms cannot name generations, so the link between a generation and a
shot is the generation id recorded in `production.json`; the file is renamed
when it is downloaded.

## Generators (targets)

`prod.mjs targets` lists them with their reference limits. Current set:
`kling-v4-omni` (default), `kling-v4-i2v`, `kling-o1-image`,
`hf-genjutsu-motion`, `hf-genjutsu-replace`, `hf-soul-2`. They live in
`packages/core/src/script/production.ts` (`GENERATION_TARGETS`). When a
platform changes its limits or models, update that table and its tests.

## CLI: `scripts/production/prod.mjs`

Run from the repository root: `node scripts/production/prod.mjs <command> <folder> …`.
`<folder>` is the project folder holding `production.json` (`targets` takes none).

| Command | What it does |
|---|---|
| `init <folder> <script.fountain> [--code TH] [--target id]` | Create `production.json` from a script |
| `status <folder> [--scene S001] [--status todo]` | Shot list with status and takes |
| `targets` | Generators and their limits |
| `entities <folder>` / `entity <folder> --kind CHR --name Mara [...]` | List / add or update an entity (Kling id, HF id, Soul id, refs, description) |
| `payload <folder> <shot> [--target id]` | The exact prompt and reference payload to submit |
| `set <folder> <shot> [--target] [--prompt] [--status] [--select N] [--image/--video/--audio path]` | Edit a shot |
| `record <folder> <shot> --id <generationId> [--target] [--prompt] [--ext]` | Record a submitted generation as the next take |
| `pending <folder>` | Takes still queued |
| `download <folder> <shot> <take> <url>` | Download and rename a finished take |
| `fail <folder> <shot> <take>` | Mark a take failed |
| `scan <folder>` | Pick up take files dropped into `shots/` by hand |
| `name-refs <folder> [--inbox refs/_inbox] [--apply]` | Local-AI naming of reference images |
| `review <folder> [<shot> [take]] [--frames 6] [--force]` | Local-AI scoring of downloaded takes |

## Local AI

`name-refs` and `review` talk to an OpenAI-compatible server (LM Studio).

| Variable | Default |
|---|---|
| `PROD_LLM_URL` | `http://localhost:1235/v1` |
| `PROD_VLM_MODEL` | `qwen3.5-4b` |

Needs `ffmpeg`/`ffprobe` on PATH. On the RTX 3060 (6 GB) the 4B vision model
peaks at about 4.9 GB; run one job at a time and keep other GPU work closed.
Review scores are a sorting aid only; never discard or regenerate a take
because of the score alone.

*Check dialogue* uses the Whisper model built into the web app (runs in the
browser, first use downloads ~100 MB); nothing extra to install.

## Shot Board (editor)

Rail button *Shot Board*. Filters by scene, status and generator; per shot:
generator, status, prompt, payload preview, takes with review score and
dialogue coverage. Toolbar:

- **Copy tasks** — prompts grouped by generator, for pasting into the platforms.
- **Connect folder / Sync** — merge with `production.json` and link take files.
- **Conform to takes** — resize shot clips to the selected takes (with review trims) and ripple. One undo.
- **Check dialogue** — Whisper the selected takes and compare with the script lines.
- **Assemble audio** — take sound to DIALOGUE A/B with J/L cuts, picture muted. One undo.
- **EDL** — CMX3600 for the whole cut or the filtered scene (Resolve / Premiere).
- **production.json** download / **Import**.

## Working with Claude Code

The project skill `.claude/skills/ai-film-production/SKILL.md` drives the
whole loop through the Kling and Higgsfield MCP servers and `prod.mjs`.
Inside the editor, the AI assistant has matching tools (`import_script`,
`update_shot`, `record_take`, `conform_to_takes`, `export_script_edl`, …);
see [`AGENT-CAPABILITIES.md`](AGENT-CAPABILITIES.md).

**Credits rule:** every Kling / Higgsfield generation costs credits. Claude
must show the payload and get an explicit yes before submitting, and must not
auto-retry failed jobs.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Editor blank, console says `does not provide an export named …` | The Vite watcher went stale. Stop `pnpm dev`, `rm -rf apps/web/node_modules/.vite`, start it again. |
| Take not linked after download | Press *Sync* on the Shot Board; check the file name follows the take pattern. |
| `name-refs` / `review` connection refused | Start LM Studio's server on port 1235 and load the vision model. |
| A generation URL expired | Kling result URLs last 24 h; re-query the task and `download` again. |
