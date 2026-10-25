# Part B: Guided Script Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-pane Script Import dialog with a three-step
guided flow — **1 Draft · 2 Script · 3 Shots** — so a user can paste any
draft, see and fix the Fountain the app made from it, and build the shot
timeline, without knowing Fountain.

**Architecture:**
- Core gains two small pure pieces: the production manifest remembers the
  source Fountain (`script`), and `summarizeScript` counts scenes,
  characters and dialogue lines for the step 2 summary.
- A web service `draft-format.ts` wraps Part A's `convertDraft` with the
  AI-settings connection, the per-chunk cache, parallelism and error
  mapping. It holds no React state and is unit-tested.
- The dialog becomes a shell with a step header and three step components
  in `apps/web/src/components/editor/script-import/`. Step state lives in
  a small pure reducer (`import-flow.ts`) so step rules are tested
  without rendering.
- Build stays one undoable `project/applyEditSnapshot` action.

**Tech Stack:** TypeScript, React, Zustand, Vitest + Testing Library,
`@openreel/ui` Toolcraft components, `@openreel/core`.

**Spec:** `docs/superpowers/specs/2026-10-24-script-to-shots-ux-design.md`
(sections 5.2, 5.3, 6 Part B, 11). Read section 6 Part B before starting.

## Global Constraints

- Pure logic in `packages/core/src/script/` with tests; the web app only
  does I/O and UI (`CLAUDE.md`).
- `ProductionManifest` stays `version: 1`. New fields are optional, so
  older `production.json` files and `prod.mjs` keep working. Merge, never
  overwrite: `mergeProductionManifest` keeps `script` when the caller
  passes none.
- `production` is already in `EditSnapshot`; do not add a new `Project`
  field.
- The conversion uses the AI settings connection (`useAIConnectionStore`)
  — no separate key or model picker. Parallel 3 for `anthropic`, 1
  otherwise. Labels cached per chunk in memory for the dialog's lifetime.
- The model never writes script words (Part A rule). The UI never sends
  the draft anywhere except through `convertDraft`'s requester.
- Never auto-retry a failed conversion; the user presses **Reformat**.
- Errors from the endpoint use `formatChatError`
  (`apps/web/src/components/editor/chat/ChatErrorCard.tsx`) so the text
  matches the chat panel.
- Icons from `@/icons/lucide-compat`. UI components from `@openreel/ui`
  Toolcraft set already used by the dialog. No new runtime dependencies.
- No `.docx`. Accepted files: `.fountain`, `.txt`, `.md`.
- Pre-commit checks from `CLAUDE.md` before the final commit.

## Review Focus

1. **Nothing the user wrote is lost silently.** Step 2 must show dropped
   lines and words the check found missing or added, and **Use this
   script** must state the count when any exist (Task 4).
2. **No AI configured on a prose draft** must still give a rule result
   plus the banner and an **Open AI settings** button, not an error
   (Task 2, Task 4).
3. **Reopening** the dialog on a project with `production.script` starts
   at step 2 with that script, and rebuilding keeps prompts/takes
   (merge) (Task 1, Task 5).
4. **Undo** after **Build timeline** restores the previous timeline and
   manifest in one step (Task 5).

## File Structure

| File | Change |
|---|---|
| `packages/core/src/script/production.ts` | `ProductionManifest.script?: string`; `mergeProductionManifest(..., script?)` keeps or replaces it |
| `packages/core/src/script/timeline-builder.ts` | `BuildScriptTimelineOptions.script?` passed to merge |
| `packages/core/src/script/summary.ts` (new) | `summarizeScript(doc)` |
| `packages/core/src/script/summary.test.ts` (new) | tests |
| `packages/core/src/script/production.test.ts`, `timeline-builder.test.ts` | script field tests |
| `apps/web/src/services/draft-format.ts` (new) | `formatDraft`, `connectionReady`, `FormatOutcome` |
| `apps/web/src/services/draft-format.test.ts` (new) | tests |
| `apps/web/src/components/editor/script-import/import-flow.ts` (new) | step reducer |
| `apps/web/src/components/editor/script-import/import-flow.test.ts` (new) | tests |
| `apps/web/src/components/editor/script-import/DraftStep.tsx` (new) | step 1 |
| `apps/web/src/components/editor/script-import/ScriptStep.tsx` (new) | step 2 |
| `apps/web/src/components/editor/script-import/ShotsStep.tsx` (new) | step 3 (moved from the old dialog) |
| `apps/web/src/components/editor/script-import/StepHeader.tsx` (new) | `1 Draft · 2 Script · 3 Shots` |
| `apps/web/src/components/editor/script-import/shot-list-export.ts` (new) | `shotListMarkdown`, `shotListCsv`, `downloadText`, `renderSlate` moved out of the dialog |
| `apps/web/src/components/editor/ScriptImportDialog.tsx` | becomes the shell |
| `apps/web/src/components/editor/ScriptImportDialog.test.tsx` (new) | flow tests |
| `docs/film-production.md`, `.claude/skills/ai-film-production/SKILL.md` | guide |

---

### Task 1: Core — manifest remembers the script, script summary

**Files:** `production.ts`, `timeline-builder.ts`, new `summary.ts`,
`index.ts` re-export, tests.

**Interfaces:**
```ts
// production.ts
export interface ProductionManifest { /* existing */ readonly script?: string }
export function mergeProductionManifest(
  existing: ProductionManifest | undefined,
  breakdown: ProductionBreakdown,
  defaultTargetId?: string,
  script?: string,          // undefined → keep existing?.script
): ProductionManifest;

// timeline-builder.ts
export interface BuildScriptTimelineOptions { /* existing */ readonly script?: string }

// summary.ts
export interface ScriptSummary { readonly scenes: number; readonly characters: number; readonly dialogueLines: number }
export function summarizeScript(doc: ScriptDocument): ScriptSummary;
export function formatScriptSummary(s: ScriptSummary): string; // "8 scenes · 5 characters · 41 dialogue lines", singular forms for 1
```

- [ ] Failing tests: merge with `script` sets it; merge without keeps the
  existing one; a manifest without `script` still loads (field absent,
  not `undefined` key written — compare with `toEqual` on an old fixture).
  `buildScriptTimeline(..., { script })` stores it in `production.script`.
- [ ] Failing tests for `summarizeScript`: counts scenes from
  `parseFountain`, distinct character names (case-insensitive, extension
  stripped), dialogue elements; `formatScriptSummary` singular/plural
  (`1 scene · 1 character · 1 dialogue line`).
- [ ] Implement; re-export from `packages/core/src/script/index.ts`.
- [ ] `pnpm --filter @openreel/core exec vitest run src/script` and core
  `tsc --noEmit` pass. Commit `feat(core): remember source script in the
  production manifest and summarize scripts`.

### Task 2: Web — `formatDraft` service

**Files:** new `apps/web/src/services/draft-format.ts` + test.

**Interfaces:**
```ts
import type { DraftConversion } from "@openreel/core";
import type { DirectConnection } from "./agent/direct-llm-transport";

export function connectionReady(conn: DirectConnection): boolean;
// anthropic/openai: apiKey non-empty; compatible: baseUrl non-empty (local servers need no key)

export type FormatOutcome =
  | { kind: "done"; conversion: DraftConversion; notice?: "needs-ai" }   // needs-ai: prose/needs-formatting and no ready connection → rules only
  | { kind: "error"; conversion: DraftConversion; title: string; message: string; details?: string };
     // endpoint failed → rule result kept, error from formatChatError

export function formatDraft(
  text: string,
  conn: DirectConnection,
  options: { cache: Map<string, DraftLabels>; signal?: AbortSignal; request?: StructuredRequester },
): Promise<FormatOutcome>;
```

- Detect kind first with Part A's exports:
  `detectDraftKind(text, classifyLines(normalizeDraft(text).lines))`
  (`packages/core/src/script/loose.ts:78,199,245`) — reuse, don't
  re-implement. Fountain kind
  → `convertDraft` without a requester (no model call).
- Ready connection → `convertDraft(text, { request: options.request ??
  makeStructuredRequester(conn), parallel: conn.provider === "anthropic"
  ? 3 : 1, cache, signal })`.
- If `convertDraft` throws (not an abort): run it again **without** a
  requester to get the rule result, and return `kind: "error"` with
  `formatChatError(String(err.message))`. This is not a retry of the model.
- Abort → rethrow `AbortError` (the dialog ignores it).

- [ ] Failing tests with an injected `request` stub: Fountain input makes
  zero calls; prose + not-ready connection → `notice: "needs-ai"`, zero
  calls; Anthropic → parallel 3 (stub counts concurrent calls on a
  3-chunk draft with `chunkLines` small — expose `chunkLines` in options
  for tests only); thrown 401 → `kind: "error"`, title from
  `formatChatError`, conversion present; cache reused on a second call
  (zero new calls).
- [ ] Implement. `pnpm --filter @openreel/web exec vitest run
  src/services/draft-format` and web `tsc` pass. Commit.

### Task 3: Step flow reducer and step header

**Files:** `script-import/import-flow.ts` + test, `StepHeader.tsx`.

**Interfaces:**
```ts
export type ImportStep = "draft" | "script" | "shots";
export interface ImportFlowState {
  step: ImportStep;
  draft: string;
  fountain: string;          // editable step 2 text; "" until formatted
  conversion: DraftConversion | null;
  formatting: boolean;
  outcome: Omit<FormatOutcome, "conversion"> | null;
  built: boolean;
}
export type ImportFlowAction =
  | { type: "setDraft"; text: string }            // clears fountain/conversion if text changed
  | { type: "formatStart" }
  | { type: "formatDone"; outcome: FormatOutcome } // sets fountain, step → "script"
  | { type: "formatAborted" }
  | { type: "editFountain"; text: string }
  | { type: "goto"; step: ImportStep }             // ignored unless reachable
  | { type: "built" };
export function initialFlow(savedScript?: string): ImportFlowState; // saved → step "script", fountain = saved, draft = saved
export function reachable(state: ImportFlowState, step: ImportStep): boolean;
// draft always; script when fountain !== ""; shots when parseFountain(fountain) has ≥1 scene
export function importFlowReducer(s: ImportFlowState, a: ImportFlowAction): ImportFlowState;
```

`StepHeader` renders three buttons `1 Draft`, `2 Script`, `3 Shots` with
`aria-current="step"` on the active one and `disabled` when not
reachable.

- [ ] Failing reducer tests: initial with/without saved script; goto
  blocked/allowed; `setDraft` with new text clears the Fountain; same
  text keeps it; `formatDone` moves to script; `built` sets flag;
  editing the Fountain to text with no scenes makes `shots` unreachable.
- [ ] Implement both. Commit.

### Task 4: Step 1 Draft and Step 2 Script components

**Files:** `DraftStep.tsx`, `ScriptStep.tsx`, tests inside
`ScriptImportDialog.test.tsx` (Task 5) or own test files.

**Step 1 — `DraftStep({ draft, kind, formatting, onDraft, onFormat, onCancel })`:**
- Textarea placeholder: "Paste your script, treatment or story. Any
  format works." File drop accepts `.fountain,.txt,.md`. Dropping a file
  while the textarea has text asks first (inline confirm row "Replace the
  pasted text with <file>?" Replace / Keep — no `window.confirm`).
- Kind badge under the textarea once text exists:
  `fountain` → "Fountain screenplay", `screenplay` → "Screenplay, needs
  formatting", `prose` → "Prose, AI will find scenes". Hint line under it
  says what happens next ("Formatting is done by rules; no AI needed" /
  "Uses the model in AI settings: <model>").
- Primary button "Continue" for Fountain, otherwise "Format script";
  while formatting it shows "Formatting…" and a Cancel button aborts.

**Step 2 — `ScriptStep({ draft, fountain, conversion, outcome, onEdit, onReformat, onOpenAISettings, onNext })`:**
- Two columns ≥ 900 px wide, stacked below: left "Your draft"
  (read-only, line numbers), right "Fountain" (editable textarea).
- Summary line from `formatScriptSummary(summarizeScript(parseFountain(fountain)))`.
- Notices, in this order, each only when it applies:
  - `needs-ai`: "Prose needs the AI assistant to find scenes. Set it up in
    AI settings." + button **Open AI settings** (`useSettingsStore`
    `openSettings("ai-editor")`).
  - error outcome: title + message + collapsible details (same text as
    the chat error card).
  - flagged chunks: "Lines X–Y: check this part — <reason>".
  - dropped lines: "Removed as page clutter: `2.`, `(MORE)` …" (all of them).
  - check problems: "Missing from the result: …" / "Added: …" words.
  - `addedHeadings > 0`: "N scene headings were added by AI — marked
    `[[added by AI]]`." AI-added heading lines are tinted in a preview
    list of headings above the editor (textarea can't tint; list the
    scene headings with `isAddedHeading` styling).
- Buttons: **Reformat** (secondary, re-runs from the draft, uses cache),
  **Copy Fountain**, **Download .fountain**, primary **Use this script**
  → step 3. When the check has problems, the primary label is
  "Use this script (N problems)".
- Editing the Fountain re-runs only the summary (no model call).

- [ ] Failing component tests (Testing Library): badge text per kind;
  file drop over text shows the confirm row; Fountain kind shows
  "Continue"; needs-ai banner + button calls `openSettings("ai-editor")`;
  dropped lines listed; problems count in primary label; editing
  updates summary.
- [ ] Implement. Commit.

### Task 5: Step 3 Shots and the dialog shell

**Files:** `ShotsStep.tsx`, `shot-list-export.ts`,
`ScriptImportDialog.tsx`, `ScriptImportDialog.test.tsx`.

- Move the preview table, project code, exports and build from the old
  dialog into `ShotsStep`. Changes from spec §6:
  - Column "Length" → "Est. length". Pages shown as decimals
    (`(eighths/8).toFixed(1)`) with `title` = `formatEighths(...)`.
  - One "Video model" select replaces the profile + "Default generator"
    pair. Options = video `GENERATION_TARGETS`; label
    `${target.label}, ${profile.minSeconds}–${profile.maxSeconds} s shots`
    (profile from `target.profileId`). Choosing one sets both
    `defaultTargetId` and `profileId`.
  - Project code input keeps, with hint "Shots will be named
    <CODE>_S001_SH01".
  - Primary "Build timeline"; text above it "Creates N scene markers and
    M placeholder shots"; existing warning that a rebuild replaces the
    SHOTS track stays.
  - After success the footer shows "Timeline built" + primary **Open
    Shot Board** (`openModal("shotBoard")`) + Close. No auto-close.
- Build passes `script: state.fountain` to `buildScriptTimeline`, still
  one `project/applyEditSnapshot`.
- Shell: `useReducer(importFlowReducer, initialFlow(project.production?.script))`,
  `StepHeader`, one `Map` cache in a `useRef`, an `AbortController` per
  format run (aborted on close/unmount), `formatDraft` with
  `useAIConnectionStore.getState()`.

- [ ] Failing integration tests (render the dialog with the real project
  store, stub `formatDraft` via `vi.mock`): paste screenplay → Format →
  step 2 shows summary → Use this script → step 3 shows "Creates 3 scene
  markers…" → Build → "Timeline built" and **Open Shot Board** calls
  `openModal("shotBoard")`; project has `production.script`; one undo
  restores the previous `production` (undefined); reopening with a saved
  script starts on step 2.
- [ ] Implement; delete the dead code from the old dialog. Run all
  `CLAUDE.md` checks. Commit.

### Task 6: Guide, skill and browser check

- [ ] Update `docs/film-production.md` "Start from any draft" and the
  import section to the three steps (screens described, no screenshots).
  Update `.claude/skills/ai-film-production/SKILL.md` where it describes
  the editor import.
- [ ] Browser check on the running dev server (http://localhost:5180;
  don't start a second one): paste `scripts/production/eval-drafts/screenplay-en.txt`,
  go through all three steps, build, open Shot Board, undo. Screenshot
  each step to the scratchpad. Report anything off.
- [ ] Commit docs.

## After Part B

Part C (Shot Board) gets its own plan; it takes the "Default generator"
control that Part B removes from import.
