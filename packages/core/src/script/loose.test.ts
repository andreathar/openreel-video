import { describe, expect, it } from "vitest";
import { normalizeDraft } from "./loose";

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
      [header, "Mara waits.", "", "12.", "(MORE)", "MARA (CONT'D)", "Go.", header, "", header, "Done.", header].join("\n"),
    );
    const out = result.lines.map((l) => l.text);
    expect(out).not.toContain(header);
    expect(out).not.toContain("12.");
    expect(out).not.toContain("(MORE)");
    expect(out).toContain("MARA");
    expect(result.dropped).toEqual(expect.arrayContaining(["12.", "(MORE)", " (CONT'D)"]));
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
