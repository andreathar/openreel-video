# Script to shots: draft conversion, guided flow, AI shot planning

Date: 2026-10-24 · Branch: `feat/ai-film-pipeline` · Status: draft for review

## 1. Goal

Make the path from *any* script draft to a prompted Shot Board obvious and
fast for one person producing a film from AI-generated shots.

What the user said:
- They do not have Fountain scripts. The assistant must read any draft and
  put it into the proper format.
- The import dialog, the Shot Board, their buttons and hints must become
  intuitive.
- Shot board generation must get better.

Assumptions (correct me):
- Drafts are a mix of prose treatments and loose screenplays pasted from
  Word, Google Docs or PDF. Some may not be in English.
- Conversion must work with the AI connection already set in AI settings:
  Anthropic (through the dev proxy) or a local LM Studio model on a 6 GB GPU.
- Paid generation stays manual. Nothing in this spec submits a Kling or
  Higgsfield job.

Success criteria:
1. Pasting a prose treatment or a loose screenplay yields Fountain that our
   `parseFountain` turns into the right scenes, characters and dialogue,
   with the author's words unchanged. Any text the model added (for example
   a scene heading for prose) is marked.
2. A draft is never silently turned into one "COLD OPEN" scene.
3. A first-time user can go from draft to a Shot Board with proposed shot
   sizes and draft prompts without reading the guide. Every button says
   what it does, and every empty state has a next action.
4. Existing `production.json` files and the CLI keep working (format is
   backwards compatible).

## 2. What exists today (summary)

- `parseFountain` (`packages/core/src/script/fountain.ts`) only recognises
  English `INT/EXT/EST/I/E` headings after a blank line. Character cues
  need an ASCII capital letter. Text before any heading goes into a
  "COLD OPEN" scene (`fountain.ts:101-107`), so prose becomes one scene of
  mechanically split shots, with no warning.
- No code converts drafts. `local-ai.ts` only has the reference-naming and
  take-review prompts.
- `planSceneShots` (`shots.ts:89-152`) splits a scene into equal-length
  shots by duration. Prompts start empty (`production.ts:274`). There is
  no shot size, angle or camera move.
- Import Script and Shot Board are separate modals. Nothing links them.
  - After a build, Import closes with only a toast.
  - The Shot Board empty state has no button, and its Import button is
    hidden until a production exists.
  - The toolbar has 9 equal buttons with jargon ("Conform", "EDL",
    "Payload", "†").
- The chat assistant only sees a fixed allowlist of editing tools
  (`apps/web/src/services/agent/editing-tools.ts:20-70`). No script tools.

## 3. Research findings that shape the design

Draft conversion:
- No open-source project reliably turns loose drafts into Fountain.
  - Parsers (screenplain, fountain-js, afterwriting) assume valid input.
  - Rule-based converters (type-text-fountain-formatter, lntcu/fountain)
    are immature, but their rules are worth porting.
- **Have the model label lines by number, not retype text.**
  - Line-number output reduces hallucination versus verbatim copying for
    large and small models (SafeLLM, arXiv 2606.12897; edit-span
    prediction, arXiv 2305.11862).
  - It also makes output about 10× shorter, so it is faster and cheaper on
    a 4B local model.
- **Constrained JSON fits classification tasks** (Tam et al., EMNLP 2024,
  "Let Me Speak Freely?"), and both backends enforce a schema:
  - LM Studio: `response_format: {type:"json_schema"}`.
  - Claude: `output_config.format`. It has no recursive schemas or length
    bounds, and needs `additionalProperties:false`.
- **Write Fountain deterministically with forced markers** (`.` heading,
  `@` cue, `!` action, `>` transition). Then non-English names and headings
  parse correctly, and the model's formatting judgement never matters.
- Use the CC0 dataset `Inkwell-Software/screenplay-format-edge-cases`
  (48 contrast specimens) as parser regression fixtures.

Shot planning and UX:
- The leading tools share one order:
  1. Break down the script.
  2. The AI *proposes* shots.
  3. A free review pass: merge, split, rewrite, set size/angle/move.
  4. Set references.
  5. Generate.
  6. Retake one shot.
  7. Approve.

  Sources: LTX Studio, Katalist, Boords, Filmustage, Higgsfield Popcorn,
  Kling 3 Multi-Shot "Smart vs Custom".
- Standard shot-list fields (StudioBinder): shot size, angle, movement,
  lens, subject, description.
- ViMax (HKUDS, MIT) storyboard rules give a proven shot-planning prompt:
  - The first shot is the widest establishing shot.
  - Reuse camera positions.
  - Each dialogue line maps to one shot.
  - Use close-ups for emotion and wides for context.
  - Give one action and one camera move per shot.
  - Describe characters by visible traits.
- Prompt structure per model:
  - Kling: subject + action + scene + camera + lighting + atmosphere.
    For image-to-video, describe motion only.
  - Seedance: subject, action, environment, camera, style; continuity
    lines go last.
- UX:
  - A stage strip, or checklist, with counts per stage (NN/g wizards and
    progress indicators).
  - Empty states with one specific call to action.
  - AI suggestions are review-first, with a "proposed" state and
    accept/reject (Filmustage, Boords).

Full source list is in section 10.

## 4. Design overview

Four parts, built in this order. Each one ships on its own.

| Part | What the user gets |
|---|---|
| A. Draft → Fountain | Paste anything; get checked Fountain with a diff |
| B. Guided Import | 3-step dialog: Draft → Script → Shots, then "Open Shot Board" |
| C. Shot Board redesign | Stage strip, grouped actions, plain labels, AI shot planning and prompt drafts (review-first) |
| D. Script tools in chat | "Format my script", "plan shots for scene 3" from the assistant |

## 5. Part A: Draft → Fountain conversion

### 5.1 Pipeline (pure logic in `packages/core/src/script/`)

```
draft text
  → loose.ts: normalizeDraft()      clean paste/PDF artifacts, number lines
  → loose.ts: classifyLines()       rule-based label + confidence per line
  → detectDraftKind()               "fountain" | "screenplay" | "prose"
  → [LLM only if needed] draft-convert.ts: buildLabelPrompt() / parseLabels()
  → draft-convert.ts: renderFountain()   forced markers, controlled blank lines
  → draft-convert.ts: verifyConversion() parseFountain + faithfulness check
```

**`loose.ts`** has no LLM and is instant.
- `normalizeDraft(text)`:
  - Normalises smart quotes, NBSP and tabs.
  - Drops page numbers, `CONTINUED:`, `(MORE)`, `(CONT'D)`, and repeated
    headers and footers.
  - Joins hard-wrapped lines (the previous line has no terminal
    punctuation and the next starts lowercase) and repairs hyphen breaks.
  - Returns `DraftLine[] = {n, text}`.
- `classifyLines(lines)`: each line gets a `guess`
  (`heading | action | character | dialogue | parenthetical | transition |
  title | note | blank`) and a `conf` from 0 to 1. Rules:
  - Headings: `INT/EXT/EST/I/E` plus localised forms (`INTERIOR`,
    `INTERNO`, `INTÉRIEUR`, `INNEN`, `EXTERIOR`, `EXTERNO`, `AUSSEN`…),
    and `Scene 1:` / `Escena 1` / `Cena 1` / `Scène 1`.
  - Character cues: an all-caps or short line followed by text, scored
    higher when the name repeats.
  - Dialogue: quoted speech in prose (`Mara says, "…"`), tab-indented
    speech, and parentheticals.
  - Transitions: `… TO:`.
- `detectDraftKind`: returns `fountain` when `parseFountain` already finds
  ≥1 scene and ≥80 % of lines are confident, `screenplay` when headings or
  cues are found, otherwise `prose`.

**`draft-convert.ts`**:
- `buildLabelPrompt(chunk, knownCharacters)`: system prompt with a short
  Fountain cheat-sheet, 2 few-shot examples and the rule *"Use only the
  line numbers given; never write new words. Only for prose without scene
  breaks may you add `headingText`."* The user content is the numbered
  lines.
- JSON schema, flat and valid for both Claude and LM Studio:

  ```json
  {"scenes":[{"headingLine":3,"headingText":null,
    "elements":[{"type":"action|dialogue|parenthetical|transition",
                 "lines":[4,5],"character":"MARA"}]}],
   "characters":["MARA"]}
  ```

- `parseLabels(raw)`: tolerant JSON extraction (reuses `extractJsonObject`)
  plus validation that every line number exists and is used at most once.
- `renderFountain(lines, labels)`:
  - Headings are written as `.HEADING`. An invented `headingText` gets a
    `[[added by AI]]` note.
  - Cues are written as `@NAME`.
  - Action that is all caps or starts with a cue-like word is written as
    `!text`.
  - Transitions are written as `>TEXT`.
  - Exactly one blank line separates blocks, with none inside dialogue.
- `verifyConversion(source, fountain, labels)`:
  - `parseFountain` scene and dialogue counts must equal the label counts.
  - The multiset of source words (dropped noise lines excluded) must equal
    the multiset of output words with markers and notes removed.
  - Returns `{ok, problems[], droppedLines[]}`.

### 5.2 Running the model

- Chunking: split at deterministic headings, otherwise every ~200 lines.
  Each chunk carries the known-character list. Chunks run in sequence on
  the local model and up to 3 in parallel on Claude.
- Repair: if `verifyConversion` fails for a chunk, re-ask once with the
  specific problem. If it still fails, keep the rule-based labels for that
  chunk and flag it in the UI. Never loop.
- Routing:
  1. A draft that is already Fountain skips everything.
  2. A loose screenplay whose lines are all confident is rendered by rules
     alone.
  3. Otherwise the configured AI connection is used.
- Transport:
  - Web: a new `completeStructured()` in `apps/web/src/services/agent/`.
    It reuses the AI connection and the direct transport. Anthropic gets
    `output_config.format`; the OpenAI-compatible path (LM Studio) gets
    `response_format: json_schema`. Temperature is 0.
  - CLI: `prod.mjs format-script <draft> [--out x.fountain]` through
    `local-ai.mjs chat()` with the same prompt and schema.
- Cache labels per chunk hash in memory, so editing one scene and
  re-converting only re-asks that chunk.

### 5.3 Errors

| Case | Behaviour |
|---|---|
| No AI configured and the draft needs it | Rule-based result + banner "Prose needs the AI assistant to find scenes. Set it up in AI settings." with a button |
| Endpoint error | Card shows the provider's message (same formatter as chat), rule-based result kept |
| Model output fails schema twice | That chunk uses rule-based labels, marked "Check this part" |
| Words lost or added | Diff highlights them. Apply is still allowed, with the count shown |

## 6. Part B: Guided Import dialog

One modal, three steps, with a step header ("1 Draft · 2 Script · 3 Shots").
Later steps are reachable once the earlier one is valid.

1. **Draft.**
   - Paste or drop any text (`.fountain .txt .md .docx`*).
   - A detected-kind badge: "Fountain screenplay", "Screenplay, needs
     formatting" or "Prose, AI will find scenes".
   - Primary button "Format script" (or "Continue" when the draft is
     already Fountain).
   - Dropping a file over pasted text asks before replacing it.
2. **Script.**
   - Side-by-side: the original on the left; the Fountain result on the
     right, editable, with AI-added headings tinted and lost words listed.
   - Summary: "8 scenes · 5 characters · 41 dialogue lines".
   - Buttons: "Reformat", "Copy Fountain", "Download .fountain".
3. **Shots.**
   - The current preview table, renamed: "Length" becomes "Est. length";
     "Pages" shows decimals with a tooltip explaining eighths.
   - Settings become one "Video model" select. Each option names its
     generator and length rule, for example "Kling 4.0, 3–30 s shots". The
     separate "Default generator" select goes; it now lives in the Shot
     Board. Project code stays, with a hint showing an example shot name.
   - The primary button "Build timeline" shows what will happen:
     "Creates 8 scene markers and 23 placeholder shots".
   - After success the dialog shows "Timeline built" with
     **"Open Shot Board"** (primary) and "Close".

\* `.docx` text extraction is optional (mammoth is about 70 kB gzipped).
Leave it out unless the user wants it.

The source script (Fountain) is stored next to the manifest
(`production.json` gains an optional `script` string). Re-opening Import
then starts from step 2 with the last script. This is backwards
compatible.

## 7. Part C: Shot Board

### 7.1 Layout and wording

- **Stage strip** under the header. Each stage shows a count and is a
  button that sets filters:

  `Script ✓ → Shots 23 → Prompts 9/23 → Takes 4/23 → Picked 2/23 → Assembled`

  The next incomplete stage is highlighted, with a one-line hint ("14 shots
  have no prompt. Draft prompts →").
- **Toolbar grouped by stage**, instead of 9 equal buttons:
  - *Plan*: "Plan shots (AI)", "Draft prompts (AI)", "Copy task list".
  - *Takes*: "Sync folder" or "Connect folder", "Fit timeline to takes"
    (renamed from Conform to takes).
  - *Sound*: "Check dialogue in takes", "Build dialogue tracks" (renamed
    from Assemble audio).
  - *Export*: menu with "EDL for finishing", "production.json",
    "Import production.json".
- Every action has a tooltip with one sentence of what it does. A small
  "?" glossary popover explains: shot, take, conform, EDL, J/L cut,
  element and payload.
- Empty state: "No shots yet" with buttons **"Import script"** (opens
  Import) and "Import production.json".
- Orphan "†" becomes a "Removed from script" badge. "★n" becomes
  "Best take n/10".
- The prompt editor saves while typing (debounced) and shows "Saved".
  "Payload" becomes "What to send to {Kling 4.0}" with "Copy".
- Footer copy without the Claude Code assumption: "Connect your production
  folder to sync prompts and downloaded takes."

### 7.2 Shot fields (manifest, backwards compatible)

New optional fields on `ProductionShot`:

```ts
size?: "EWS"|"WS"|"FS"|"MS"|"MCU"|"CU"|"ECU"|"INSERT";
angle?: "eye"|"high"|"low"|"overhead"|"dutch"|"ots";
move?: "static"|"push-in"|"pull-out"|"pan"|"tilt"|"track"|"handheld"|"crane"|"orbit";
lens?: number;            // mm
purpose?: string;         // establish / reaction / insert …
proposal?: { source: "ai"; model: string; at: number; prompt?: string; accepted?: boolean };
```

Absent fields mean "not planned". `mergeProductionManifest` keeps them
across rebuilds, as it does for prompts.

### 7.3 "Plan shots (AI)" (review-first)

- Runs for one scene or all scenes. Input: the scene's elements, the
  current mechanical split, the profile's length limits and the entity
  list.
- The prompt is based on the ViMax rules:
  - Open with the widest establishing shot.
  - Map each dialogue line to a shot.
  - Use close-ups for emotion.
  - One action and one camera move per shot.
  - Reuse camera positions.
  - At most 2–3 characters per shot.
- Output is JSON: per shot, the source line range, size, angle, move,
  purpose, seconds (snapped to the profile) and a one-sentence
  description.
- The result is shown as a **proposal diff** for the scene: merged and
  split shots, new sizes. The user chooses "Apply", "Apply to this scene"
  or "Discard".
- Apply runs one undoable `project/applyEditSnapshot` (rebuild the SHOTS
  track for those scenes) and updates the manifest. Shot ids are
  re-numbered only for shots without takes. Shots with takes keep their
  ids, following the existing orphan rule.

### 7.4 "Draft prompts (AI)" (review-first)

- For selected shots, or all shots without a prompt, the AI writes one
  prompt per shot from:
  - description, size/angle/move;
  - entity display names and descriptions;
  - the scene heading (location and time of day);
  - the target's template:
    - Kling text-to-video: `[size, angle], [lens]. <<<CHR>>> (traits),
      [position/facing], [one action + endpoint]. [location, time].
      Camera: [move]. Lighting: [...]. Dialogue: "...".`
    - Kling image-to-video: motion only.
    - Seedance: subject, action, environment, camera, style, then
      continuity lines last.
- Prompts land as `proposal.prompt` with status unchanged. The detail pane
  shows "Suggested prompt" with "Use", "Edit" and "Discard". Bulk accept
  is available from the stage hint.
- Entity tokens stay `<<<CODE>>>` so `buildShotPrompt` keeps substituting
  Kling elements.
- These templates live in `production.ts` next to `GENERATION_TARGETS`,
  so the CLI skill uses the same ones.

## 8. Part D: Script tools in chat

- Add to the chat allowlist (`editing-tools.ts`), with keyword routing on
  script/screenplay/fountain/scene/shot/prompt:
  - `format_script_draft {text}`: runs Part A and returns the Fountain
    plus problems. Read-only.
  - `import_script` (exists; `dryRun` default true in chat).
  - `list_script_shots`, `get_shot_prompt` (exist).
  - `update_shot` (exists). It needs confirmation in chat because it
    changes prompts.
  - `plan_shots {sceneCode}` and `draft_shot_prompts {shotIds}`: these
    return proposals. Nothing is applied until the user accepts in the
    Shot Board.
- `EDITING_SYSTEM` gets a script paragraph. Script text stays untrusted
  data.
- Chat placeholder: "Ask the AI to edit your video or format a script…".
- The Import dialog's Draft step has "Ask the assistant" for edge cases.
- Register the same tools in `packages/agent/src/registry.ts` so MCP and
  Claude Code get them, and regenerate `docs/AGENT-CAPABILITIES.md`.

## 9. Testing

- `loose.test.ts`:
  - each heuristic, including PDF artifacts and Word paste;
  - non-English headings and cues;
  - the 48 Inkwell CC0 specimens as parser fixtures (vendored under
    `packages/core/src/script/__fixtures__/`).
- `draft-convert.test.ts`:
  - render with forced markers;
  - verify catches dropped or added words;
  - parseLabels rejects unknown or duplicate line numbers;
  - round-trip: labels → Fountain → `parseFountain` gives the expected
    scenes.
- Model-free tests use recorded label JSON. A manual eval script
  (`scripts/production/eval-format.mjs`) runs 6 sample drafts against LM
  Studio and Claude and prints scene/dialogue accuracy and the
  faithfulness diff. It is not part of CI.
- Shot planning and prompt templates: pure functions tested with fixed
  model output. `mergeProductionManifest` keeps the new fields.
- UI: component tests for step gating, empty-state CTAs and
  stage-strip counts. A manual browser pass at 1280 px and 1920 px.
- Pre-commit checks from `CLAUDE.md`.

## 10. Sources

- LTX Studio storyboard: https://ltx.io/blog/ltx-storyboard-generator-update ·
  https://ltx.io/blog/how-to-storyboard
- Filmustage breakdown: https://filmustage.com/script-breakdown/
- StudioBinder shot list fields: https://www.studiobinder.com/blog/shot-list-template-free-download/
- Boords AI storyboard: https://boords.com/ai-storyboard-generator
- Katalist: https://www.katalist.ai/agentic-storyboarder
- Higgsfield Popcorn: https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-popcorn
- Kling 3 multi-shot: https://kling.ai/blog/kling-video-3-multi-shot-guide ·
  image-to-video guide https://kling.ai/quickstart/image-to-video-guide
- Seedance 2.0 prompts: https://runway.com/resources/seedance-2-0-prompt-guide
- ViMax (MIT): https://github.com/HKUDS/ViMax: `agents/storyboard_artist.py`, `interfaces/camera.py`
- MovieAgent: https://github.com/showlab/MovieAgent: `movie_agent/system_prompts.py`
- Storyboarder STS: https://github.com/wonderunit/storyboarder/wiki/Shot-Template-System-(STS)-for-Storyboarder
- screenplain (MIT): https://github.com/vilcans/screenplain
- type-text-fountain-formatter (MIT): https://github.com/chaalpritam/type-text-fountain-formatter
- Edge-case corpus (CC0): https://huggingface.co/datasets/Inkwell-Software/screenplay-format-edge-cases
- Tam et al. 2024, "Let Me Speak Freely?": https://arxiv.org/abs/2408.02442
- SafeLLM: https://arxiv.org/html/2606.12897 · edit spans: https://arxiv.org/html/2305.11862
- LM Studio structured output: https://lmstudio.ai/docs/developer/openai-compat/structured-output
- Claude structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- NN/g wizards: https://www.nngroup.com/articles/wizards/ · progress: https://www.nngroup.com/articles/progress-indicators/
- Carbon empty states: https://carbondesignsystem.com/patterns/empty-states-pattern/

Unverified and to measure on our own samples:
- 4B-model accuracy on non-English drafts.
- The best chunk size.
- Kling multi-shot limits (sources disagree: 5 or 6 shots).

## 11. Open questions for the user

1. Should `.docx` import be included (adds mammoth)?
2. Default model for conversion: whatever AI settings hold (proposed), or
   always prefer local LM Studio and fall back to Claude?
3. Part order: A → B → C → D (proposed). Prompt drafting (7.4) could come
   before shot planning (7.3) if prompts matter more to you right now.
