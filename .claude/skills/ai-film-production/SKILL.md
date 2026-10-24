---
name: ai-film-production
description: Use when generating, tracking or downloading shots, characters, locations or props for an OpenReel film production with Kling or Higgsfield (MCP or CLI) — "generate shot S003_SH02", "create the Kling element for MARA", "download pending takes", "sync the production folder", "what's left to prompt". Keeps production.json, platform element names and local file names in one naming pattern.
---

# AI film production (Kling + Higgsfield ↔ OpenReel)

The production folder is the single source of truth:

```
<folder>/production.json                     shots, entities, takes (shared with the editor's Shot Board)
<folder>/refs/CHR/HSTL-CHR-MARA/front.png    entity reference images
<folder>/shots/S001/HSTL_S001_SH01_kl-v4_T01.mp4
```

All bookkeeping goes through `node scripts/production/prod.mjs <command> <folder> …` (run it with no
arguments for the list). Never edit production.json by hand and never rename files yourself — the
CLI computes names; the editor relinks clips by those names.

## Naming (do not improvise)

| Thing | Pattern | Example |
|---|---|---|
| Entity (character/location/prop/voice) | `<PROJ>-<CHR\|LOC\|PRP\|VOX>-<SLUG>` (≤32 chars) | `HSTL-CHR-MARA` |
| Shot | `<PROJ>_S<scene3>_SH<shot2>` | `HSTL_S012_SH03` |
| Take file | `<shot>_<modelTag>_T<take2>.<ext>` | `HSTL_S012_SH03_kl-v4_T02.mp4` |
| Higgsfield folder (optional) | `<PROJ>/S<scene3>/SH<shot2>` | `HSTL/S012/SH03` |

Use the entity code as the element **name** on both Kling (`element_create name`) and Higgsfield
(`manage_reference_elements name`). Generations themselves cannot be named on either platform —
that is why every submission must be recorded with `prod record` immediately, before polling.

User guide (all commands, buttons, troubleshooting): `docs/film-production.md`. Repo rules: `CLAUDE.md`.

## Workflow

0. **Start a production** (once): `prod init <folder> <script.fountain> --code <PROJ> [--target id]`
   creates `production.json`, or the user imports the script in the editor (rail *Import script*)
   and connects the same folder in the Shot Board. Script changes later: re-import in the editor;
   prompts, targets and takes of surviving shots are kept, removed shots that already have takes are kept as `orphaned`.
1. **Orient**: `prod status <folder>` (add `--status todo|prompted|queued`) and `prod entities <folder>`.
2. **File new references** (local GPU, free): drop images into `refs/_inbox/`, run
   `prod name-refs <folder>` — the local VLM proposes kind, code, description and Kling tags per
   image in `refs/_inbox/naming.json`. Show the proposals to the user, edit wrong ones (or
   `"skip": true`), then `prod name-refs <folder> --apply` moves them to
   `refs/<KIND>/<CODE>/<CODE>_NN.ext` and fills the entity. Reuse its `description` and `tags`
   for the platform element.
3. **Entities first** — a shot that mentions a character without a platform element only gets text.
   - Kling: `file_upload` the ref images → `element_create` (name = entity code, tags e.g.
     `Characters`/`Scenes`/`Items`, cover + 1–3 secondary) → `prod entity <folder> --kind CHR --name MARA --kling-id <id>`.
   - Higgsfield: `media_upload` → PUT bytes → `media_confirm` → `manage_reference_elements action=create`
     (name = entity code) → `prod entity … --hf-id <uuid>`. Soul characters: `--soul-id <id>`.
   - Check first with `element_list` / `manage_reference_elements action=list` that the code is not
     already there; Higgsfield silently suffixes duplicates (`HSTL-CHR-MARA-2`).
4. **Prompt**: write the visual prompt per shot (`prod set <folder> <shot> --prompt "…"`), using the
   entity display names. `prod payload <folder> <shot>` turns names into `<<<elementId>>>` and returns
   tool, model, duration, elements JSON, reference files and `issues`. **Fix every issue before
   submitting** (too many references for the model, missing start image/video, etc.). Switch
   generator with `--target` (`prod targets` lists limits).
5. **Ask before spending credits.** Show the user the shot list, generator and seconds (Kling bills
   per second) and get a yes. Never auto-resubmit failed jobs.
6. **Submit** exactly what `payload` returned:
   - `kling-v4-omni` → `omni_ref_video` model `kling-video-v4_0`, arguments `prompt`, `duration`,
     `elements` (from payload), aspect/resolution from the user; reference files go in `inputs`
     after `file_upload` (`image_1…`, `video_1…`, `audio_1…`) and are named in the prompt as
     `图片1` / `视频1` / `音频1`. `aspect_ratio=auto` only when an image or video input is given —
     text + elements only needs `16:9` (or the project's ratio). Tell the user it bills per second,
     input video seconds included.
   - `kling-v4-i2v` / `kling-o1-image` → `image_to_video` / `image_to_image`; call `who_am_i` with that
     tool first for its arguments.
   - `hf-genjutsu-motion` / `hf-genjutsu-replace` → `generate_video` model `hf_mult_motion_control` /
     `hf_mult_replace_object` with `medias` roles `image_references` and `video_references`.
   - `hf-soul-2` → `generate_image` model `soul_2` (`soul_id`, optional `style_id`; style cannot be
     combined with medias).
7. **Record immediately**: `prod record <folder> <shot> --id <generationId|job_id> --target <id>
   --prompt "<final prompt>"`. It prints the take's file name.
8. **Collect**: `prod pending <folder>`; poll with Kling `query_tasks` / Higgsfield `jobs_wait`
   (≤15 s per call). On success `prod download <folder> <shot> <take> <url>` (Kling URLs expire in
   24 h — download promptly). On failure relay the exact error and `prod fail <folder> <shot> <take>`.
9. **Files downloaded by hand**: put them in `shots/<scene>/` with the name from `record`, then
   `prod scan <folder>`.
10. **Review takes** (local GPU, free): `prod review <folder>` scores every unreviewed downloaded
   take 0–10 against the shot and its entity references and suggests trims. Treat it as triage —
   point the user at low scores, never discard or regenerate on the score alone.
11. **Hand back to the editor**: tell the user to press **Sync** in the Shot Board (it also syncs
   every 10 s while open). The editor links the selected take — or the newest finished one — to
   the shot's placeholder clip. `prod set … --select N` picks a take.
12. **Conform** (editor): once takes are linked, **Conform to takes** in the Shot Board (agent tool
   `conform_to_takes`) sets each linked clip to the take's real length — or its review trim range —
   and ripples the SHOTS track and scene markers. It overwrites manual trims on those clips, so say
   so first; it is one undo step. The scene strip (agent `get_scene_runtimes`) shows timeline vs
   script-estimated seconds per scene — report scenes drifting more than 20 %.
13. **Dialogue** (editor): **Check dialogue** transcribes linked takes with the in-browser Whisper
   and marks each take with how many script lines were heard (`lines N%`); a take below 100 % may
   have dropped or garbled a line — tell the user which. **Assemble audio** moves each take's sound
   to DIALOGUE A/B tracks (alternating), mutes the picture, and lets sound cross a cut by 0.5 s
   (J/L cut) where the line touches the edge and the take has spare source. Re-run it after a
   conform; it rebuilds the dialogue tracks. Both are one undo step.
14. **Finish**: **EDL** in the Shot Board (agent `export_script_edl`, optional `sceneCode`) gives a
   CMX3600 EDL; in Resolve, import it with the `shots/` folder as the media location. Shots without
   a take appear as black events so the cut keeps its length.

## CLI alternative

`kling` and `higgsfield` CLIs (both on PATH; `hf` is the Hugging Face CLI, not Higgsfield) accept
the same models and arguments. `higgsfield generate create … --wait` prints the job id — record it
the same way.

Local AI uses LM Studio at `http://localhost:1235/v1` with `qwen3.5-4b` (override with
`PROD_LLM_URL`, `PROD_VLM_MODEL` or `--model`). Jobs run one at a time — the 6 GB GPU fits one
4B vision model; unload other models in LM Studio first if `gpuPeakMiB` nears 6000.

## Don'ts

- Don't create one platform element per shot; elements are per entity and reused.
- Don't change a shot's `id` or scene; re-import the script in the editor instead (it keeps
  prompts, targets and takes for shots that still exist).
- Don't put credentials in production.json.
- Don't trust platform limits from memory: if a submission is rejected for references, models or
  duration, check `who_am_i` / `models_explore` and update `GENERATION_TARGETS` in
  `packages/core/src/script/production.ts` (with tests) rather than working around it.
- If the editor goes blank after code changes (`does not provide an export named …`), restart the
  Vite dev server and clear `apps/web/node_modules/.vite`.
