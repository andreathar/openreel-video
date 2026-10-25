# Film production with OpenReel

This fork turns OpenReel into a production desk for AI-generated films: a
Fountain screenplay becomes a shot list on the timeline, every shot is
prompted on Kling or Higgsfield, downloaded takes land in a project folder
under one naming pattern, and the cut is conformed, dialogue-assembled and
exported as an EDL.

Design history and the reasoning behind each choice:
[`docs/superpowers/plans/2026-10-24-ai-film-production-pipeline.md`](superpowers/plans/2026-10-24-ai-film-production-pipeline.md).

## The loop at a glance

1. **Write** the script in Fountain (`.fountain`), or start from any draft
   (see *Start from any draft* below).
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

## Start from any draft

You do not need to write Fountain by hand. A treatment, a story in plain prose, or a
screenplay pasted from a PDF or a word processor can be converted first.

- **In the editor**: the guided import arrives in a later part of this work. Until then use the CLI.
- **With the CLI**: `node scripts/production/prod.mjs format-script <folder> draft.txt`
  writes `<folder>/script.fountain`. A relative draft path is looked up in `<folder>` first,
  then in the current directory. `--out` picks another file (a relative path is taken from
  `<folder>`, an absolute path is used as is); an existing file is only replaced with
  `--force`. Then run `prod.mjs init <folder> <folder>/script.fountain`.
- **When the model is used.** A draft that is already clean Fountain (nothing to clean up, no bare
  title line; a Fountain title page is fine) is copied unchanged. A screenplay whose every line the rules read with confidence (headings, cues, dialogue,
  transitions) is formatted by rules alone, also after page artifacts are removed. Prose, and
  screenplays with lines the rules are unsure of, are labelled by the local model (LM Studio,
  see *Local AI*). `--no-ai` never calls the model: unsure lines keep the rule reading and are flagged, and
  prose comes out as action paragraphs without scene headings, flagged `needs the local model`.
- **Your words are never rewritten.** The model only returns line numbers saying which lines are
  headings, action, cues, parentheticals, dialogue and transitions; every line of the output is
  copied from the draft. Before that, cleanup removes only page numbers (a line holding just a
  number of up to three digits, optionally followed by `.`), the markers `(MORE)`, `(CONT'D)`,
  `(CONTINUED)` and `CONTINUED:` written exactly so (and ` (CONT'D)` after a cue), and a running
  header: a line of at most six words repeated at least three times, each time alone between
  blank lines (or right after a page number), that is not shaped like a character cue (capitals
  only), does not end in `:` or a sentence mark and is not a heading. The line directly under a
  capitals-only line (a cue) is never removed, so a reply `More` or `42` stays in its speech, and
  a cue, `CUT TO:` or a one-word reply that repeats is kept. A line that
  continues in lowercase after a line broken mid-sentence is rejoined to it (a word hyphenated
  across the break becomes one word). The command prints every removed line under
  `dropped`.
- **The word check** compares the words of the output with the words of the file you gave it,
  minus exactly the dropped lines. Any other difference is printed as `missing words` or
  `added words`.
- **Title.** A Fountain title page at the top (a block of `Title:`, `Credit:`, `Author:`,
  `Authors:`, `Source:`, `Draft date:`, `Date:`, `Contact:`, `Copyright:`, `Notes:` or
  `Revision:` lines, ending in a blank line) is copied as it is. A single line in capitals of two
  to eight words, without closing punctuation, that is the only text before the first scene
  heading of a screenplay is taken as the film's title and becomes the title page
  (`Title: …`); anything less sure, such as `Darkness`, stays action. A first line that only
  looks like a title-page entry with another key, such as `Treatment: The Lighthouse Keeper`,
  is kept as action (`!` prefix).
- **`[[added by AI]]`**: prose has no scene headings, so the model may propose one per scene
  (for example `INT. KITCHEN - NIGHT`). It is the only text the model writes, and only for prose:
  it must be one line of at most 60 characters shaped like a scene heading, or the reply is
  rejected. It is marked with this note on the same line so you can find and fix it; the
  importer ignores the note.
- **Review the flags.** The command prints the draft kind, whether AI labels were used, the
  number of scenes, speeches, action blocks, transitions and AI headings, the title page and the
  dropped lines. It then lists each chunk it could not trust as `lines 12–40 of draft.txt: reason`,
  in line numbers of your file. A chunk whose model reply was invalid twice, or ran out of output
  tokens, falls back to the rule-based reading, so read those lines in the output. If the draft
  cannot be read, the output file exists without `--force`, or the model cannot be reached or
  returns an error, the command prints the message and exits 1 without writing a file; otherwise it exits 0, even with flags or a failed check: the file is a first
  draft for you to review.

`node scripts/production/eval-format.mjs` scores the model on three sample drafts in
`scripts/production/eval-drafts/` (run by hand with LM Studio up; it never loads a model).
Screenplays are scored on exact scene headings and dialogue; prose on scene count and a fuzzy
location match, since the model invents those headings. It also prints the dropped lines and
the word check per draft.

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
| `format-script <folder> <draft.txt\|md> [--out script.fountain] [--model id] [--no-ai] [--force]` | Format any draft (prose or loose screenplay) as Fountain; the local model only labels lines (`--no-ai`: rules only) |
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
