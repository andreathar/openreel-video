import { describe, expect, it } from "vitest";
import type { FormatOutcome } from "../../../services/draft-format";
import { importFlowReducer, initialFlow, reachable } from "./import-flow";

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

  it("setDraft clears fountain only when text changes", () => {
    let s = importFlowReducer(initialFlow(), { type: "formatDone", outcome: done() });
    expect(s.step).toBe("script");
    expect(s.fountain).toBe(SCRIPT);
    const same = importFlowReducer(s, { type: "setDraft", text: s.draft });
    expect(same.fountain).toBe(SCRIPT);
    s = importFlowReducer(s, { type: "setDraft", text: "new" });
    expect(s.fountain).toBe("");
    expect(s.conversion).toBeNull();
    expect(s.outcome).toBeNull();
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
    expect(importFlowReducer(built, { type: "setDraft", text: "other" }).built).toBe(false);
  });

  it("treats a whitespace-only fountain as empty and leaves the unreachable step", () => {
    const s = initialFlow(SCRIPT);
    expect(importFlowReducer(s, { type: "editFountain", text: "  \n " }).step).toBe("draft");
    expect(reachable({ ...s, fountain: "  \n" }, "script")).toBe(false);
  });
});
