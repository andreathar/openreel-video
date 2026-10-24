# CLAUDE.md

Instructions for Claude Code in this repository.

## What this fork is

A personal fork of OpenReel (browser video editor, pnpm monorepo) customized
for producing films from AI-generated shots: Fountain script → shot list on the
timeline → prompts on Kling / Higgsfield → takes downloaded under one naming
pattern → conform, dialogue assembly, EDL. User guide:
[`docs/film-production.md`](docs/film-production.md). Design record and
rationale: [`docs/superpowers/plans/2026-10-24-ai-film-production-pipeline.md`](docs/superpowers/plans/2026-10-24-ai-film-production-pipeline.md).

Daily driver is the **web app** in a desktop browser on a single Linux machine
with a 6 GB GPU. Keep features local-first and light on GPU memory; a local
LLM (LM Studio) may already be holding most of it.

## Where the film-production code lives

| Area | Path |
|---|---|
| Naming, Fountain parser, length estimate, shot profiles | `packages/core/src/script/{naming,fountain,estimate,shots}.ts` |
| Production manifest, generators (`GENERATION_TARGETS`), takes, review, speech | `packages/core/src/script/production.ts` |
| Script → timeline, apply manifest, scene runtimes, conform | `packages/core/src/script/timeline-builder.ts` |
| Dialogue J/L assembly | `packages/core/src/script/assemble.ts` |
| CMX3600 EDL | `packages/core/src/script/edl.ts` |
| Local-AI prompts and parsers | `packages/core/src/script/local-ai.ts` |
| Tests for all of the above | `packages/core/src/script/*.test.ts` |
| Agent tools (`import_script` … `export_script_edl`) | `packages/agent/src/registry.ts` |
| Editor UI | `apps/web/src/components/editor/{ScriptImportDialog,ShotBoardDialog}.tsx` |
| Folder sync, dialogue check, audio assembly | `apps/web/src/services/{production-folder,take-dialogue,scene-assembly}.ts` |
| CLI | `scripts/production/prod.mjs`, `scripts/production/local-ai.mjs` |
| Claude Code skill | `.claude/skills/ai-film-production/SKILL.md` |

Pure logic goes in `packages/core/src/script/` with tests; the web app and the
CLI only do I/O around it. Both the browser and `prod.mjs` read and write the
same `production.json`, so keep its format backwards compatible
(`ProductionManifest.version`) and merge, never overwrite blindly.

## Conventions

- Naming: entity `<PROJ>-<CHR|LOC|PRP|VOX>-<SLUG>` (≤ 32 chars), shot
  `<PROJ>_S###_SH##`, take `<shot>_<modeltag>_T##.<ext>`. Change only in
  `naming.ts`, and update the guide and skill with it.
- A new `Project` field only survives undo/redo and snapshot edits if it is
  listed in `EditSnapshot` (`packages/core/src/actions/handlers/edit-snapshot.ts`).
- Timeline-wide changes (conform, assembly) are one undoable
  `project/applyEditSnapshot` action.
- When adding or changing agent tools, regenerate the tool reference:
  `cd packages/agent && npx tsx src/gen-docs-cli.ts` (writes `docs/AGENT-CAPABILITIES.md`).
- When platform limits or models change, update `GENERATION_TARGETS`, its
  tests, the guide's generator list and the skill.
- UI icons come from `@/icons/lucide-compat` (re-exports lucide-react).

## Paid generation

Kling and Higgsfield generations cost the user's credits. Never submit one
without showing the payload (model, prompt, references, duration) and getting
an explicit yes. Never auto-retry a failed or timed-out job. Reading, listing
and querying are free.

## Running and checking

- Dev server: `pnpm dev` → **http://localhost:5180** (`apps/web/vite.config.ts`).
  The user usually has one running; don't start a second one.
- If the editor goes blank with `does not provide an export named …` although
  the export exists, the Vite watcher stopped seeing `packages/core`. Stop the
  server, `rm -rf apps/web/node_modules/.vite`, start it again.
- Vite strips comments from served modules; to check what it serves, grep for code.
- Before committing:
  ```bash
  pnpm --filter @openreel/core exec vitest run
  pnpm --filter @openreel/agent exec vitest run
  pnpm --filter @openreel/core exec tsc --noEmit
  pnpm --filter @openreel/agent exec tsc --noEmit
  pnpm --filter @openreel/web exec tsc --noEmit -p .
  pnpm -s check:retired-cloud-gpu
  ```
  The core run prints one known stack trace while still passing.
- Local AI for the CLI: LM Studio at `PROD_LLM_URL` (default
  `http://localhost:1235/v1`), model `PROD_VLM_MODEL` (default `qwen3.5-4b`).
  Needs `ffmpeg`/`ffprobe`.

## Other guidance files

- `ASTRYX.md` — the Astryx UI kit (used by some apps, not the web editor's Shot Board).
- `CONTRIBUTING.md` — upstream contribution guide.
- `docs/AGENT-GUIDE.md`, `docs/ai-editing.md` — the in-editor AI assistant.
