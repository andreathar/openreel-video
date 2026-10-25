import { describe, expect, it } from "vitest";
import { CONFIDENT, classifyLines, detectDraftKind, normalizeDraft, type ClassifiedLine } from "./loose";

const texts = (text: string) => normalizeDraft(text).lines.map((l) => l.text);

describe("normalizeDraft", () => {
  it("normalizes paste artifacts", () => {
    const result = normalizeDraft("Mara runs.\r\n\r\n\r\n“Stop!”");
    expect(result.lines.map((l) => l.text)).toEqual(["Mara runs.", "", '"Stop!"']);
    expect(result.lines.map((l) => l.n)).toEqual([1, 2, 3]);
  });

  it("drops pdf page artifacts", () => {
    const header = "MY FILM - Draft 3";
    const result = normalizeDraft(
      [header, "", "Mara waits.", "", "12.", header, "", "(MORE)", "MARA (CONT'D)", "Go.", "", header, "", "Done.", "", header].join("\n"),
    );
    const out = result.lines.map((l) => l.text);
    expect(out).not.toContain(header);
    expect(out).not.toContain("12.");
    expect(out).not.toContain("(MORE)");
    expect(out).toContain("MARA");
    expect(result.dropped).toEqual(expect.arrayContaining(["12.", "(MORE)", " (CONT'D)"]));
    expect(result.dropped.filter((d) => d === header)).toHaveLength(4);
  });

  it("keeps repeated non-ASCII cues, transitions and short lines", () => {
    const block = (i: number) => `JOSÉ\nOlá ${i}.\n\nCUT TO:\n\nNo\nShe waits ${i}.`;
    const result = normalizeDraft([1, 2, 3].map(block).join("\n\n"));
    const out = result.lines.map((l) => l.text);
    expect(out.filter((t) => t === "JOSÉ")).toHaveLength(3);
    expect(out.filter((t) => t === "CUT TO:")).toHaveLength(3);
    expect(out.filter((t) => t === "No")).toHaveLength(3);
    expect(result.dropped).toEqual([]);
  });

  it("keeps a repeated line that is not alone between blank lines", () => {
    const out = texts(["Mara", "No", "", "Leo", "No", "", "Mara", "No", ""].join("\n"));
    expect(out.filter((t) => t === "No")).toHaveLength(3);
  });

  it("keeps the source line of every line", () => {
    const result = normalizeDraft("Mara waits.\n\n\n\n  2.\nShe opens the\ndoor.\n\nTHE LIGHTS FAIL");
    expect(result.lines.map((l) => [l.text, l.sourceLine, l.sourceEnd])).toEqual([
      ["Mara waits.", 1, 1],
      ["", 2, 4],
      ["She opens the door.", 6, 7],
      ["", 8, 8],
      ["THE LIGHTS FAIL", 9, 9],
    ]);
  });

  it("records hyphen joins", () => {
    expect(normalizeDraft("over-\nwhelmed.").joins).toEqual([{ before: "over-\nwhelmed.", after: "overwhelmed." }]);
  });

  it("keeps repeated cues and short repeated dialogue", () => {
    const out = texts(["MARA", "Yes.", "", "MARA", "Yes.", "", "MARA", "Yes.", "", "MARA"].join("\n"));
    expect(out.filter((t) => t === "MARA")).toHaveLength(4);
    expect(out.filter((t) => t === "Yes.")).toHaveLength(3);
  });

  it("joins hard-wrapped prose", () => {
    expect(texts("She opens the\ndoor and waits.")).toEqual(["She opens the door and waits."]);
    expect(texts("over-\nwhelmed.")).toEqual(["overwhelmed."]);
    expect(texts("MARA\nhello")).toEqual(["MARA", "hello"]);
  });

  it("collapses blank runs and trims the edges", () => {
    expect(texts("\n\n  A.\n\n\n\n  B.\n\n")).toEqual(["A.", "", "B."]);
  });
});

const classify = (source: string): ClassifiedLine[] => classifyLines(normalizeDraft(source).lines);

describe("classifyLines", () => {
  it("classifies an English loose screenplay", () => {
    const source = "INT. KITCHEN - NIGHT\n\nMara drops the cup.\n\nMARA\n(quiet)\nIt's late.\n\nLEO\nI know.\n\nCUT TO:";
    const lines = classify(source);
    expect(lines.map((l) => l.guess)).toEqual([
      "heading", "blank", "action", "blank", "character", "parenthetical", "dialogue",
      "blank", "character", "dialogue", "blank", "transition",
    ]);
    expect(detectDraftKind(source, lines)).toBe("fountain");
  });

  it("classifies Portuguese and Spanish drafts", () => {
    const source = "INTERNO - COZINHA - NOITE\n\nEscena 2\n\nJOSÉ\nHola.";
    const lines = classify(source);
    expect(lines.filter((l) => l.guess !== "blank").map((l) => l.guess)).toEqual([
      "heading", "heading", "character", "dialogue",
    ]);
    expect(detectDraftKind(source, lines)).toBe("screenplay");
  });

  it("treats accented capitals as capitals", () => {
    expect(texts("ÉLAN\nça va")).toEqual(["ÉLAN", "ça va"]);
    expect(texts("Ela abre a\nàs portas.")).toEqual(["Ela abre a às portas."]);
    const lines = classify("ÉDOUARD\nÇa va.\n\nINNEN. STRAßE - NACHT");
    expect(lines.map((l) => l.guess)).toEqual(["character", "dialogue", "blank", "heading"]);
    expect(classify("Ça marche.")[0]).toMatchObject({ guess: "action", conf: 0.9 });
  });

  it("marks a capitalized action line with low confidence", () => {
    const lines = classify("THE LIGHTS FAIL\nNobody moves.");
    expect(lines[0]).toMatchObject({ guess: "character", conf: 0.7 });
    expect(lines[0].conf).toBeLessThan(CONFIDENT);
  });

  it("detects prose", () => {
    const source = "It was a quiet morning in the village.\nNothing moved.\n\nThe baker opened his shop at dawn.";
    const lines = classify(source);
    expect(lines.filter((l) => l.guess !== "blank").every((l) => l.guess === "action")).toBe(true);
    expect(detectDraftKind(source, lines)).toBe("prose");
  });
});
