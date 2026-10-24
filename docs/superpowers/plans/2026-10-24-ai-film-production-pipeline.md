# AI Film Production Pipeline — Evaluation & Implementation Plan

**Date:** 2026-10-24
**Status:** Implemented — phases 1–5 done on branch `feat/ai-film-pipeline` (c522378, 8a7280f, ae44096, a838b9e, e6a49e6, 0616d17). Usage: `docs/film-production.md`. Not yet tried end to end with paid generations or a Resolve EDL import.
**Target machine:** Linux, i7, 32 GB RAM, RTX 3060 6 GB
**Goal:** Turn OpenReel into a personal film-production cockpit: script → shot list → prompts on Kling / Higgsfield → generated assets land locally with one naming pattern → auto-placed on the timeline.

---

## 1. Research summary (what we can build on)

### 1.1 Claude (Oct 2026)
| Capability | Use in OpenReel |
|---|---|
| Models: Opus 5.5 `claude-opus-5-5`, Sonnet 5.5 `claude-sonnet-5-5`, Haiku 5.5 `claude-haiku-5-5` (1M context) | Opus/Sonnet for script breakdown & prompt writing; Haiku for cheap batch naming/tagging when local LLM is too weak |
| No native video input — frames (≤~600 images/request) + transcript | "Review this generation" = ffmpeg sample N frames → vision call |
| PDF `document` blocks (≤32 MB / 600 pages) | Import screenplay PDFs directly, no local PDF parsing needed for the LLM pass |
| Structured outputs (`output_config.format` JSON Schema / strict tools) | Guaranteed-valid `ScriptBreakdown` JSON |
| Prompt caching (5 min / 1 h) | Cache the full script + character bible once, iterate on scenes cheaply |
| MCP connector in API, Agent SDK, Claude Code skills/hooks | Orchestrate Kling + Higgsfield + OpenReel MCP from one agent |
| Related connectors: Clipkit (JSON timeline renderer), HyperFrames (HTML→video titles), Adobe (Express/Firefly level) | Not needed for core; HyperFrames is a possible title/lower-third source later |

Caveat: on Opus 5.5 / Sonnet 5.5 a forced `tool_choice` returns 400 — the existing agent loop in `packages/agent/src/llm.ts` must use `auto` + structured outputs.

### 1.2 Kling (MCP + `kling` CLI 0.2.3, already authenticated)
- **Elements** = reusable subjects: `name`, `description`, `tags` ∈ {Characters, Animals, Items, Costumes, Scenes, Effects, Others}; cover + 1–3 images, or 3–60 s video; optional voice mp3. `element_list` returns only `{id, name}`.
- **Use** in prompt as `<<<ELEMENT_ID>>>` (not on text_to_*).
- **Tasks:** `generationId` + `taskTraceId` (UUIDv7, one per objective). **No history listing** → we must record every `generationId` ourselves. **Result URLs expire (~24 h)** → download immediately.
- **Durations:** v2.5/v2.6 5|10 s · o1 3–10 s · v3.0 / turbo / omni 3–15 s · v4.0 3–30 s. Aspect 16:9 / 9:16 / 1:1 (+21:9 on v4).
- Every submission is billed → never auto-retry.

### 1.3 Higgsfield (MCP + `higgsfield`/`higgs` CLI 1.2.2, authenticated)
- **Projects → folders → assets** (`project create`, `project folders create|rename|move`, `project assets add|list|move`). Folder names ≤100 chars. This is the natural mirror of our local folder tree.
- **Reference elements** (character / environment / prop): name **≤32 chars, spaces → `-`, unique per workspace (collision → numeric suffix)**. Used as `<<<UUID>>>` in prompts. Kling 3.0 on Higgsfield needs a `start_image` to honor elements.
- **Soul ID** characters (5–20 photos) for identity consistency.
- `generate list/get`, `list_project_assets` (no URLs — fetch via job display/get).
- ⚠ `hf` on this machine resolves to the HuggingFace CLI (pyenv shim). Always invoke `higgsfield`.

### 1.4 Screenplay
- **Fountain** is the plain-text standard; `fountain-js` (TS) yields `scene_heading` (+`scene_number`), `action`, `character`, `dialogue`, `transition` tokens. FDX (Final Draft) is XML and easy to parse; PDF goes through Claude.
- **Duration heuristics:** 1 page ≈ 1 min; production uses eighths (1/8 page ≈ 7.5 s); dialogue ≈ 130–150 wpm; action lines usually play shorter than their page length (multipliers: dialogue 1.0×, action 0.7×, montage 0.5×, establishing 0.3×).

### 1.5 Local models on RTX 3060 6 GB
- Vision/naming: **qwen3-vl:4b** (~3.3 GB Q4) — best fit; gemma3:4b alternative; qwen3-vl:8b only with CPU offload.
- Transcription: faster-whisper / whisper.cpp int8 (large-v3-turbo ≈ 2–3 GB).
- Run **one GPU model at a time**; serialize jobs (a GPU job queue, see Phase 4).
- Served via Ollama / LM Studio / llama-server OpenAI-compatible `/v1` — already supported by the `openai-compatible` provider (`apps/web/src/stores/settings-store.ts:51`, default `http://localhost:1235/v1`).

---

## 2. Current codebase — what exists, what's missing

| Area | Exists | Gap for this plan |
|---|---|---|
| Project model `packages/core/src/types/project.ts:26` | JSON project, IndexedDB + `.oreel` files | No production/shot metadata |
| Tracks `timeline.ts:37` | `name`, `role` | no color/notes (fine) |
| Clips `timeline.ts:118` | `metadata?: ClipMetadata` open index sig (`:82`) | **no name** → shot code must live in media name + `metadata.shot` |
| Markers `timeline.ts:265` | point markers `{time,label,color}` | **no range/region** → scenes need regions |
| Media `project.ts:57` | `name`, `isPlaceholder`, `sourceFile.folder`, `kieaiTaskId` precedent | no tags, no bins, no provider ids |
| Relink `apps/web/src/components/editor/AssetsPanel.tsx:817-870` | dir picker, name+size match, persisted handle | top-level only; size match blocks placeholder→generated relink |
| Agent `packages/agent/src/registry.ts` | 303 tools incl. `add_track`, `rename_track`, `add_marker`, `rename_media`, `batch_actions`; `tool-router.ts` prompt filtering | no script / shot / provider tools |
| MCP server `apps/desktop/src/main/mcp/*`, stdio shim `openreel-mcp` | Claude Code can already drive the editor | none — reuse |
| Desktop fs IPC `apps/desktop/src/preload/index.ts:5-45` | read/write file, dialogs | **no readdir, no watch, no child_process bridge** |
| Generative precedent `apps/web/src/services/kieai/*`, `useKieAIPoller.ts` | provider service + poller + store pattern | copy the pattern for Kling/Higgsfield |
| Script import | — | everything |

Constraint: `scripts/check-retired-cloud-gpu.mjs` forbids the old hosted backend names — new code must not reintroduce `AICloudJob`, `GpuJob`, etc.

---

## 3. Core design decision: the Production Manifest is the source of truth

Platforms are **mirrors**; the local project folder is canonical. Everything (naming, sync, task list, timeline placeholders) hangs off one file:

```
~/Movies/<PROJ>/                       # project root (user-chosen)
  production.json                      # manifest (source of truth)
  script/  <PROJ>_script_v03.fountain
  refs/    chars/ envs/ props/         # element source images
  shots/   S012/ <shot files>
  audio/   vo/ music/ sfx/
  edit/    <PROJ>.oreel
```

### 3.1 Naming pattern (fits Higgsfield's 32-char element limit)
```
Entity (element):  <PROJ>-<KIND>-<SLUG>              HSTL-CHR-MARA        (≤32, A-Z0-9 and '-')
                   KIND ∈ CHR | ENV | PRP | CST | VOX
Shot:              <PROJ>_S<sss>_SH<hh>               HSTL_S012_SH03
Take file:         <PROJ>_S<sss>_SH<hh>_<plat>-<model>_T<tt>.<ext>
                                                      HSTL_S012_SH03_kl-v4_T02.mp4
                   plat ∈ kl (Kling) | hf (Higgsfield) | loc (local) | ext
Audio:             <PROJ>_S<sss>_<VO|MUS|SFX>_<slug>_T<tt>.wav
Higgsfield folder: <PROJ>/S012                        (mirrors shots/S012)
```
Rules: uppercase codes, no spaces (Higgsfield would rewrite them), deterministic so a name can be **parsed back** into scene/shot/take — that's what makes auto-relink and auto-placement work. A shared `naming.ts` (core package) owns `format()`/`parse()`/`validate()`; every other feature calls it.

### 3.2 Manifest schema (sketch)
```ts
interface ProductionManifest {
  version: 1; projectCode: string;           // "HSTL"
  entities: Entity[];                        // characters, envs, props, voices
  scenes: Scene[];                           // from script
  generations: Generation[];                 // every billed job ever submitted
}
interface Entity { code: string; kind: 'CHR'|'ENV'|'PRP'|'CST'|'VOX'; displayName: string;
  description: string; localRefs: string[];
  kling?: { elementId: string; tags: string[]; syncedAt: string };
  higgsfield?: { elementId: string; soulId?: string; syncedAt: string } }
interface Scene { id: string /*S012*/; heading: string; intExt: string; location: string;
  timeOfDay: string; pageEighths: number; estSeconds: number; characters: string[];
  summary: string; shots: Shot[] }
interface Shot { id: string /*HSTL_S012_SH03*/; seconds: number; framing?: string;
  action: string; dialogue?: string; entities: string[];
  prompts: { kling?: string; higgsfield?: string; negative?: string };
  target: { platform: 'kling'|'higgsfield'; model: string; aspect: string };
  status: 'todo'|'prompted'|'queued'|'generated'|'downloaded'|'selected'|'approved';
  selectedTake?: string }
interface Generation { take: string; platform; model; generationId: string; taskTraceId?: string;
  prompt: string; params: Record<string,string>; submittedAt; status;
  localPath?: string; sha256?: string; costCredits?: number }
```
`Generation` records exist because Kling has **no history listing** — if we don't write the `generationId` down at submit time it's unrecoverable.

---

## 4. Phased plan

Each phase is independently useful and has an evaluation gate.

### Phase 0 — Baseline & guardrails (½ day)
- Record a baseline: time to set up a 10-scene project by hand today; local LLM tokens/sec for qwen3-vl:4b; export time 1080p on NVENC.
- Pin which local LLM endpoint is used (Ollama vs LM Studio port 1235).
- **Gate:** numbers written into this doc for later comparison.

### Phase 1 — Script → Timeline (the headline feature) (3–4 days)
1. **Parser** `packages/core/src/script/`: `parseFountain()` (fountain-js), `parseFdx()`, plain-text fallback (scene-heading regex `^(INT|EXT|EST|INT\.?/EXT|I/E)[. ]`). PDF → Claude `document` block.
2. **Estimator** `estimateSceneSeconds(scene)`: eighths-of-page baseline, refined by word counts (dialogue at 140 wpm, action ×0.7) — deterministic, unit-tested, no LLM required.
3. **Shot splitter**: split each scene into shots no longer than the target model's max (Kling v3 15 s, v4 30 s, Seedance per spec) and snapped to allowed durations (e.g. v2.6 only 5|10). This turns the timeline directly into a **generation task list**.
4. **Optional LLM breakdown** (Claude Sonnet 5.5 with structured output + cached script, or local model for small scripts): characters/locations extraction, shot framing, per-platform prompt drafts using `<<<entity>>>` placeholders.
5. **Timeline build** (one undo step via `batch_actions`):
   - Add **scene regions**: extend `Marker` with optional `duration?` and `kind?: 'scene'` (back-compatible) — renders as a colored band labelled `S012 · INT. KITCHEN – NIGHT`.
   - Track `V1 · SHOTS` filled with **placeholder media items** (`isPlaceholder: true`, `name = shot id`, `duration = shot seconds`) — a slate-card thumbnail with shot id + action line.
   - Track `A1 · DIALOGUE` placeholders where dialogue exists; optional `SUB` track with dialogue as subtitles for timing reference.
6. **UI:** "Import Script…" in the project menu → preview table (scene, est. length, shots, editable) → "Build Timeline".
7. **Agent tools** (registry): `import_script`, `list_scenes`, `list_shots`, `update_shot`, `rebuild_scene_timeline`.
- **Eval:** 3 real scripts (short, dialogue-heavy, action-heavy). Pass if scene count matches 100 %, total runtime estimate within ±15 % of the editor's own judgment, timeline build < 2 s for 100 scenes, single undo reverts it.

### Phase 2 — Production Manifest + Shot Board (task list) (3 days)
- `naming.ts` + manifest read/write (desktop: real file in project root; web: File System Access dir handle, already persisted by `saveDirectoryHandle`).
- **Shot Board panel**: table/kanban by scene → shot, columns *todo → prompted → generated → selected → approved*, filters per platform/model/character, total credits, "copy prompt" button, export as Markdown/CSV checklist.
- Clicking a shot jumps the playhead to its placeholder; status color shows on the clip.
- **Eval:** a full project's checklist can be produced from the script alone; zero manual renames needed afterwards.

### Phase 3 — Kling & Higgsfield sync (4–6 days)
Two delivery tracks — do **A first** (cheap, uses what's installed), B when it proves its worth:

**A. Orchestrated by Claude Code (no new network code in the app).**
Claude Code already has Kling MCP, Higgsfield MCP and `openreel-mcp`. Ship a project skill `.claude/skills/openreel-production/SKILL.md` that teaches: read manifest → ensure entities exist on each platform under canonical names (create/update elements, mirror Higgsfield folders `<PROJ>/S012`) → submit shot with prompt from manifest → **write `generationId` to manifest immediately** → poll → download to `shots/S012/<take name>` → call OpenReel MCP to relink placeholder. Plus a `PostToolUse` hook that appends every Kling/Higgsfield generation id to `production.json` as a safety net.

**B. Native desktop bridge** (`apps/desktop/src/main/ipc/genai.ts`):
- Spawn the authenticated CLIs (`kling … --quiet` JSON, `higgsfield …`) via `child_process` from the main process (renderer stays sandboxed); expose `window.openreel.genai.{submit, poll, download, listElements, syncEntity}`.
- Add `fs.readdir` + `fs.watch` IPC so `shots/` is watched: any file whose name parses via `naming.parse()` auto-relinks to its placeholder and becomes a take (clip `metadata.takes[]`, active take swappable in inspector).
- Reuse the `kieai` service/poller/store pattern (`apps/web/src/services/kieai/*`, `useKieAIPoller.ts`).
- **Reconcile command**: diff manifest vs `element_list` / Higgsfield `manage_reference_elements list` / `list_project_assets` → report missing, renamed (Higgsfield suffix collisions like `HSTL-CHR-MARA-2`), orphaned; fix with one click.

Safety: every submit shows a cost quote (`higgsfield generate cost`) and requires a click; never auto-retry (both platforms bill per submission).
- **Eval:** 20-shot test sequence → 0 orphan generations, 0 manual renames, 100 % placeholders relinked, reconcile report clean, no duplicate billed submissions.

### Phase 4 — Local AI tuned to the 3060 (2–3 days)
- **Local GPU job queue** (one model loaded at a time): batch-name/tag imported refs with qwen3-vl:4b → proposes `KIND/SLUG` + description that feeds Kling element `description`/`tags`; user confirms.
- **Take QA**: sample 6–8 frames per take → local VLM (fast) or Claude (accurate) scores character consistency vs entity refs, flags artifacts at head/tail → suggests trim points (`trim_clip`).
- faster-whisper int8 for dialogue timing → snap dialogue placeholders to real VO.
- Route by task: naming/tagging → local; script breakdown & prompt writing → Claude Sonnet; final QA ambiguity → Claude with frames. Make this a routing table in settings, not hard-coded.
- **Eval:** naming accuracy ≥ 90 % accepted without edit on 50 refs; VRAM never > 5.5 GB; batch of 50 images < 3 min.

### Phase 5 — Editing efficiency (ongoing, pick by pain)
- Take swapping (`metadata.takes`) with A/B compare.
- Scene-aware auto-assembly: once all shots in a scene are `selected`, assemble with handles trimmed and audio J/L-cuts (system prompt already encodes this guidance, `packages/agent/src/system-prompt.ts:31`).
- Re-estimate runtime vs actual and show drift per scene.
- Export EDL/OTIO per scene (OTIO export precedent `packages/core/src/multicam/otio.ts`).

---

## 5. Evaluation framework (how we decide each feature is worth keeping)
| Metric | How measured | Target |
|---|---|---|
| Setup time script→ready task list | stopwatch vs Phase 0 baseline | −80 % |
| Naming errors | `naming.validate()` over `shots/` + platform listings | 0 |
| Orphan / unrecorded generations | reconcile report | 0 |
| Wasted credits (duplicate/failed resubmits) | manifest `costCredits` | trend ↓ |
| Runtime estimate error | estimate vs final cut per scene | ±15 % |
| Local GPU stability | `nvidia-smi` peak during queue | < 5.5 GB, no OOM |

## 6. Files likely touched
- `packages/core/src/types/timeline.ts` (Marker `duration?`/`kind?`, `ClipMetadata.shot?/takes?`)
- `packages/core/src/script/*` (new), `packages/core/src/production/{naming,manifest}.ts` (new)
- `packages/agent/src/registry.ts`, `packages/agent/src/tool-router.ts` (add `SCRIPT_TERMS`/`PRODUCTION_TERMS`)
- `apps/web/src/components/editor/{ScriptImportDialog,ShotBoardPanel}.tsx` (new), `AssetsPanel.tsx` (name-only relink for placeholders, recursive dirs)
- `apps/desktop/src/main/ipc/{fs.ts,genai.ts}`, `apps/desktop/src/preload/index.ts`
- `.claude/skills/openreel-production/SKILL.md`, `.claude/settings.json` hook

## 7. Risks
- Platform tool schemas change often (Kling MCP asks to compare `mcpVersion`) → keep platform calls behind one adapter per provider; Phase 3A (skill) absorbs churn for free.
- Higgsfield silently suffixes duplicate names → reconcile must store ids, never trust names alone.
- URL expiry → download in the same flow as completion; store sha256.
- Estimation is a heuristic → always editable in preview; it's a planning aid, not truth.

## 8. Suggested order
Phase 1 → 2 → 3A → 3B-web (folder relink) → 4 → 5. Phase 1 alone delivers the script→timeline task list; 2+3A deliver naming/sync.

## 9. Decisions (owner, 2026-10-24)
1. **Web build (Chrome) is the daily driver.** Phase 3B moves from Electron to the browser:
   - The browser cannot run `kling`/`higgsfield` CLIs, so **3A (Claude Code skill + MCP) is the only sync engine**. It writes `production.json` and downloads takes into the project folder.
   - The web app opens that folder via the File System Access API (handle already persisted by `saveDirectoryHandle`), re-scans `shots/` recursively on focus and every few seconds (use `FileSystemObserver` when the browser exposes it), and relinks any file whose name parses via `naming.parse()`.
   - Current relink is top-level only (`apps/web/src/components/editor/AssetsPanel.tsx:817-870`); add recursive scan.
2. **Script format: Fountain** (`.fountain`, plain text). Reasons: open spec, parses deterministically in the browser (fountain-js) with no LLM, diff-friendly, writable in any editor, and Final Draft/Highland/WriterSolo/Beat export it. Plus a **"Draft → Fountain"** command: paste free prose/outline, Claude converts it to Fountain, the user reviews it, then it is parsed normally. FDX/PDF import stays a later nice-to-have.
3. **Naming: neither platform lets you name a generation.** Verified on Kling MCP/CLI 0.2.3 and Higgsfield MCP/CLI 1.2.2: generation calls take no name/title argument, and the platforms name downloads from IDs/prompt text. Prompts cannot control it; putting the shot code in the prompt would only leak into the image. What *is* nameable:
   - Kling: Elements (`name`, `description`, `tags`).
   - Higgsfield: Elements (≤32 chars, auto-suffix on collision), Projects, Folders (≤100 chars).
   - Strategy: name everything that *can* be named with the canonical pattern; for generations, **record `generationId`/`job_id` → shot code in `production.json` at submit time** and rename on download (`HSTL_S012_SH03_kl-v4_T02.mp4`). Higgsfield outputs also get filed into folder `HSTL/S012/SH03` so the web UI groups them correctly. The platform's own odd names then stop mattering. Files the user downloads by hand from the website can be matched later by the reconcile command (job id in filename/metadata, else manual pick).
4. **Default shot length & model:** still open — proposal: Kling v3 Omni 5 s, Higgsfield Seedance 2.0 5 s, overridable per shot.
5. **Claude API key** for script breakdown and prompt drafting. Browser calls go direct with `anthropic-dangerous-direct-browser-access: true` via the existing `anthropic-compatible` provider (`apps/web/src/stores/settings-store.ts:51`); Sonnet 5.5 with prompt caching on the script; key stays in the existing local secure settings.
