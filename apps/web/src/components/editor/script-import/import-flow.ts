import { parseFountain, type DraftConversion } from "@openreel/core";
import type { FormatOutcome } from "../../../services/draft-format";

export type ImportStep = "draft" | "script" | "shots";

export interface ImportFlowState {
  step: ImportStep;
  draft: string;
  /** Editable step 2 text; "" until formatted. */
  fountain: string;
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
  | { type: "goto"; step: ImportStep }
  | { type: "built" };

export function initialFlow(savedScript?: string): ImportFlowState {
  const saved = savedScript ?? "";
  return {
    step: saved ? "script" : "draft",
    draft: saved,
    fountain: saved,
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

export function importFlowReducer(s: ImportFlowState, a: ImportFlowAction): ImportFlowState {
  switch (a.type) {
    case "setDraft":
      if (a.text === s.draft) return s;
      return { ...s, draft: a.text, fountain: "", conversion: null, outcome: null, built: false };
    case "formatStart":
      return { ...s, formatting: true };
    case "formatAborted":
      return { ...s, formatting: false };
    case "formatDone": {
      const { conversion, ...outcome } = a.outcome;
      return { ...s, formatting: false, conversion, outcome, fountain: conversion.fountain, step: "script" };
    }
    case "editFountain":
      if (a.text.trim() === "" && s.step !== "draft") return { ...s, fountain: a.text, step: "draft", built: false };
      return { ...s, fountain: a.text, built: false };
    case "goto":
      return reachable(s, a.step) ? { ...s, step: a.step } : s;
    case "built":
      return { ...s, built: true };
  }
}
