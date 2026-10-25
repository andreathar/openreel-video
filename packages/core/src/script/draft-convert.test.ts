import { describe, expect, it } from "vitest";
import { labelsFromRules, renderFountain, verifyConversion, type DraftLabels, type LabelElement } from "./draft-convert";
import { parseFountain } from "./fountain";
import { classifyLines, normalizeDraft, type DraftLine } from "./loose";

const SAMPLE = "INT. KITCHEN - NIGHT\n\nMara drops the cup.\n\nMARA\n(quiet)\nIt's late.\n\nLEO\nI know.\n\nCUT TO:";

const draft = (source: string): DraftLine[] => [...normalizeDraft(source).lines];
const el = (type: LabelElement["type"], lines: number[], character = "", cueLine = 0): LabelElement => ({
  type,
  lines,
  character,
  cueLine,
});
const labelsOf = (...elements: LabelElement[]): DraftLabels => ({
  scenes: [{ headingLine: 0, headingText: "", elements }],
  characters: [],
});

describe("draft conversion", () => {
  it("round-trips a rule-labelled screenplay", () => {
    const lines = draft(SAMPLE);
    const labels = labelsFromRules(classifyLines(lines));
    const fountain = renderFountain(lines, labels);
    const doc = parseFountain(fountain);
    expect(doc.scenes).toHaveLength(1);
    expect(doc.scenes[0].heading).toBe("INT. KITCHEN - NIGHT");
    expect(doc.scenes[0].elements.filter((e) => e.type === "dialogue")).toMatchObject([
      { character: "MARA", parenthetical: "quiet", text: "It's late." },
      { character: "LEO", text: "I know." },
    ]);
    expect(doc.scenes[0].elements.find((e) => e.type === "transition")).toMatchObject({ text: "CUT TO:" });
    expect(verifyConversion(lines, labels, fountain)).toMatchObject({ ok: true, problems: [] });
  });

  it("forces ambiguous action", () => {
    const lines = draft("THE LIGHTS FAIL\nNobody moves.\n\nINTERCUT WITH:");
    const labels = labelsOf(el("action", [1, 2]), el("action", [4]));
    const fountain = renderFountain(lines, labels);
    expect(fountain).toContain("!THE LIGHTS FAIL");
    expect(fountain).toContain("!INTERCUT WITH:");
    const doc = parseFountain(fountain);
    expect(doc.scenes.flatMap((s) => s.elements).filter((e) => e.type === "dialogue")).toHaveLength(0);
    expect(verifyConversion(lines, labels, fountain).ok).toBe(true);
  });

  it("keeps non-English names with forced cues", () => {
    const lines = draft("JOSÉ\nHola.");
    const labels = labelsOf(el("dialogue", [2], "JOSÉ", 1));
    const fountain = renderFountain(lines, labels);
    expect(fountain).toContain("@JOSÉ");
    expect(parseFountain(fountain).scenes[0].elements[0]).toMatchObject({ character: "JOSÉ" });
  });

  it("keeps a cue extension from the source cue", () => {
    const lines = draft("MARA (V.O.)\nHello.");
    const labels = labelsOf(el("dialogue", [2], "MARA", 1));
    const fountain = renderFountain(lines, labels);
    expect(fountain).toContain("@MARA (V.O.)");
    expect(verifyConversion(lines, labels, fountain).ok).toBe(true);
  });

  it("marks AI headings and excludes them from the word check", () => {
    const lines = draft("The waves roll in.\n\nMara walks along the shore.");
    const labels: DraftLabels = {
      scenes: [{ headingLine: 0, headingText: "ext. beach - day", elements: [el("action", [1]), el("action", [3])] }],
      characters: [],
    };
    const fountain = renderFountain(lines, labels);
    expect(fountain).toContain(".EXT. BEACH - DAY [[added by AI]]");
    expect(parseFountain(fountain).scenes[0].heading).toBe("EXT. BEACH - DAY");
    expect(verifyConversion(lines, labels, fountain).ok).toBe(true);
  });

  it("reports dropped words", () => {
    const lines = draft("Mara drops the cup.");
    const labels = labelsOf(el("action", [1]));
    const check = verifyConversion(lines, labels, "Mara drops the.\n");
    expect(check.ok).toBe(false);
    expect(check.missingWords).toEqual(["cup"]);
  });

  it("keeps inline quotes as action", () => {
    const lines = draft('Mara says, "Get down."');
    const labels = labelsOf(el("action", [1]));
    const fountain = renderFountain(lines, labels);
    expect(parseFountain(fountain).scenes[0].elements[0]).toEqual({ type: "action", text: 'Mara says, "Get down."' });
    expect(verifyConversion(lines, labels, fountain).ok).toBe(true);
  });

  it("writes unlabelled lines as action and reports them", () => {
    const lines = draft("Mara waits.\n\nLeo arrives.");
    const labels = labelsOf(el("action", [1]));
    const fountain = renderFountain(lines, labels);
    expect(fountain).toContain("Leo arrives.");
    expect(verifyConversion(lines, labels, fountain).problems).toContain("1 lines were not labelled");
  });
});
