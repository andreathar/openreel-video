import { deriveProjectCode, normalizeProjectCode, parseFountain, type DraftConversion } from "@openreel/core";
import type { FormatOutcome } from "../../../services/draft-format";

export type ImportStep = "draft" | "script" | "shots";

export interface ImportFlowState {
  step: ImportStep;
  draft: string;
  /** Editable step 2 text; "" until formatted. */
  fountain: string;
  /** The last formatted (or saved) Fountain; `fountain` differing from it means hand edits. */
  formatted: string;
  /** Inline "Replace your edited script?" confirm is showing. */
  confirmReplace: boolean;
  conversion: DraftConversion | null;
  formatting: boolean;
  outcome: Omit<FormatOutcome, "conversion"> | null;
  built: boolean;
}

export type ImportFlowAction =
  | { type: "setDraft"; text: string }
  | { type: "formatStart" }
  | { type: "formatDone"; outcome: FormatOutcome }
  | { type: "formatAborted" }
  | { type: "editFountain"; text: string }
  | { type: "askReplace" }
  | { type: "keepEdits" }
  | { type: "goto"; step: ImportStep }
  | { type: "built" }
  | { type: "unbuilt" };

export function initialFlow(savedScript?: string): ImportFlowState {
  const saved = savedScript ?? "";
  return {
    step: saved ? "script" : "draft",
    draft: saved,
    fountain: saved,
    formatted: saved,
    confirmReplace: false,
    conversion: null,
    formatting: false,
    outcome: null,
    built: false,
  };
}

export function reachable(state: ImportFlowState, step: ImportStep): boolean {
  if (step === "draft") return true;
  if (state.fountain.trim() === "") return false;
  if (step === "script") return true;
  return parseFountain(state.fountain).scenes.length >= 1;
}

/** Why a step header button is disabled, or null when the step can be opened. */
export function unreachableReason(state: ImportFlowState, step: ImportStep): string | null {
  if (reachable(state, step)) return null;
  if (state.fountain.trim() === "") return "Format a draft first";
  return "The script has no scene headings";
}

/**
 * The project code the dialog uses for shot names, the build and the download name:
 * the typed code, else the saved one, else one derived from the title or project name, else PROJ.
 */
export function effectiveProjectCode(p: { typed: string; saved?: string; title?: string; projectName?: string }): string {
  return normalizeProjectCode(p.typed || p.saved || deriveProjectCode(p.title ?? p.projectName ?? "") || "PROJ");
}

/** Step 2 holds text the user typed that a new format run would replace. */
export function hasHandEdits(state: ImportFlowState): boolean {
  return state.fountain.trim() !== "" && state.fountain !== state.formatted;
}

export function importFlowReducer(s: ImportFlowState, a: ImportFlowAction): ImportFlowState {
  switch (a.type) {
    case "setDraft":
      // Step 2 keeps its text until the user formats again (ruling P6).
      if (a.text === s.draft) return s;
      return { ...s, draft: a.text };
    case "formatStart":
      return { ...s, formatting: true, confirmReplace: false };
    case "formatAborted":
      return { ...s, formatting: false };
    case "formatDone": {
      const { conversion, ...outcome } = a.outcome;
      return {
        ...s,
        formatting: false,
        confirmReplace: false,
        conversion,
        outcome,
        fountain: conversion.fountain,
        formatted: conversion.fountain,
        step: "script",
        built: false,
      };
    }
    case "askReplace":
      return { ...s, confirmReplace: true };
    case "keepEdits":
      return { ...s, confirmReplace: false, step: reachable(s, "script") ? "script" : s.step };
    case "editFountain":
      if (s.formatting) return s;
      if (a.text.trim() === "" && s.step !== "draft") return { ...s, fountain: a.text, step: "draft", built: false };
      return { ...s, fountain: a.text, built: false };
    case "goto":
      return reachable(s, a.step) ? { ...s, step: a.step } : s;
    case "built":
      return { ...s, built: true };
    case "unbuilt":
      return s.built ? { ...s, built: false } : s;
  }
}
