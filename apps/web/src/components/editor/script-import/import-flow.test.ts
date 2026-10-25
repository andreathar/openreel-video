import { describe, expect, it } from "vitest";
import type { FormatOutcome } from "../../../services/draft-format";
import { effectiveProjectCode, hasHandEdits, importFlowReducer, initialFlow, reachable, unreachableReason } from "./import-flow";

const SCRIPT = "INT. ROOM - DAY\n\nMARA enters.\n";
const conversion = { fountain: SCRIPT } as never;
const done = (): FormatOutcome => ({ kind: "done", conversion });

describe("import flow", () => {
  it("starts on draft without a saved script", () => {
    const s = initialFlow();
    expect(s.step).toBe("draft");
    expect(s.fountain).toBe("");
    expect(reachable(s, "script")).toBe(false);
    expect(reachable(s, "shots")).toBe(false);
  });

  it("starts on script with a saved script", () => {
    const s = initialFlow(SCRIPT);
    expect(s.step).toBe("script");
    expect(s.fountain).toBe(SCRIPT);
    expect(s.draft).toBe(SCRIPT);
    expect(reachable(s, "shots")).toBe(true);
  });

  it("blocks and allows goto", () => {
    const s = initialFlow();
    expect(importFlowReducer(s, { type: "goto", step: "script" }).step).toBe("draft");
    const t = initialFlow(SCRIPT);
    expect(importFlowReducer(t, { type: "goto", step: "shots" }).step).toBe("shots");
    expect(importFlowReducer(t, { type: "goto", step: "draft" }).step).toBe("draft");
  });

  it("setDraft keeps the formatted script (P6: nothing is discarded until the user formats again)", () => {
    let s = importFlowReducer(initialFlow(), { type: "formatDone", outcome: done() });
    expect(s.step).toBe("script");
    expect(s.fountain).toBe(SCRIPT);
    s = importFlowReducer(s, { type: "editFountain", text: SCRIPT + "\nMy edit." });
    s = importFlowReducer(s, { type: "setDraft", text: "new" });
    expect(s.draft).toBe("new");
    expect(s.fountain).toBe(SCRIPT + "\nMy edit.");
    expect(s.conversion).toBe(conversion);
  });

  it("tracks hand edits against the last formatted output", () => {
    const saved = initialFlow(SCRIPT);
    expect(hasHandEdits(saved)).toBe(false);
    const formatted = importFlowReducer(initialFlow(), { type: "formatDone", outcome: done() });
    expect(hasHandEdits(formatted)).toBe(false);
    const edited = importFlowReducer(formatted, { type: "editFountain", text: SCRIPT + "\nMore." });
    expect(hasHandEdits(edited)).toBe(true);
    expect(hasHandEdits(importFlowReducer(edited, { type: "editFountain", text: SCRIPT }))).toBe(false);
  });

  it("asks before replacing edits and keeps them on dismiss", () => {
    let s = importFlowReducer(initialFlow(SCRIPT), { type: "editFountain", text: SCRIPT + "\nMine." });
    s = importFlowReducer(s, { type: "goto", step: "draft" });
    s = importFlowReducer(s, { type: "askReplace" });
    expect(s.confirmReplace).toBe(true);
    const kept = importFlowReducer(s, { type: "keepEdits" });
    expect(kept.confirmReplace).toBe(false);
    expect(kept.fountain).toBe(SCRIPT + "\nMine.");
    expect(kept.step).toBe("script");
    const replaced = importFlowReducer(importFlowReducer(s, { type: "formatStart" }), {
      type: "formatDone",
      outcome: { kind: "done", conversion: { fountain: "INT. NEW - DAY\n" } as never },
    });
    expect(replaced.confirmReplace).toBe(false);
    expect(replaced.fountain).toBe("INT. NEW - DAY\n");
    expect(hasHandEdits(replaced)).toBe(false);
  });

  it("ignores Fountain edits while a format run is in flight", () => {
    const s = importFlowReducer(initialFlow(SCRIPT), { type: "formatStart" });
    expect(importFlowReducer(s, { type: "editFountain", text: "x" })).toBe(s);
  });

  it("unbuilt clears the built flag", () => {
    const built = importFlowReducer(initialFlow(SCRIPT), { type: "built" });
    expect(importFlowReducer(built, { type: "unbuilt" }).built).toBe(false);
  });

  it("formatStart/Aborted toggle formatting", () => {
    const s = importFlowReducer(initialFlow(), { type: "formatStart" });
    expect(s.formatting).toBe(true);
    expect(importFlowReducer(s, { type: "formatAborted" }).formatting).toBe(false);
  });

  it("built sets the flag", () => {
    expect(importFlowReducer(initialFlow(SCRIPT), { type: "built" }).built).toBe(true);
  });

  it("fountain without scenes makes shots unreachable", () => {
    const s = importFlowReducer(initialFlow(SCRIPT), { type: "editFountain", text: "Title: Untitled" });
    expect(reachable(s, "shots")).toBe(false);
    expect(reachable(s, "script")).toBe(true);
  });

  it("editing after a build resets built", () => {
    const built = importFlowReducer(initialFlow(SCRIPT), { type: "built" });
    expect(built.built).toBe(true);
    expect(importFlowReducer(built, { type: "editFountain", text: SCRIPT + "\nMore." }).built).toBe(false);
  });

  it("treats a whitespace-only fountain as empty and leaves the unreachable step", () => {
    const s = initialFlow(SCRIPT);
    expect(importFlowReducer(s, { type: "editFountain", text: "  \n " }).step).toBe("draft");
    expect(reachable({ ...s, fountain: "  \n" }, "script")).toBe(false);
  });

  it("explains why a step is unreachable", () => {
    expect(unreachableReason(initialFlow(), "draft")).toBeNull();
    expect(unreachableReason(initialFlow(), "script")).toBe("Format a draft first");
    expect(unreachableReason(initialFlow(), "shots")).toBe("Format a draft first");
    const noScenes = importFlowReducer(initialFlow(SCRIPT), { type: "editFountain", text: "Title: Untitled" });
    expect(unreachableReason(noScenes, "shots")).toBe("The script has no scene headings");
    expect(unreachableReason(initialFlow(SCRIPT), "shots")).toBeNull();
  });

  it("picks the effective project code: typed, then saved, then derived, then PROJ", () => {
    expect(effectiveProjectCode({ typed: "abc", saved: "VLT", title: "The Heist" })).toBe("ABC");
    expect(effectiveProjectCode({ typed: "", saved: "VLT", title: "The Heist" })).toBe("VLT");
    expect(effectiveProjectCode({ typed: "", title: "The Heist" })).toBe(effectiveProjectCode({ typed: "", title: "The Heist", projectName: "Other" }));
    expect(effectiveProjectCode({ typed: "" })).toBe("PROJ");
  });
});
