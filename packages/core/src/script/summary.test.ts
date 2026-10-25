import { describe, expect, it } from "vitest";
import { parseFountain } from "./fountain";
import { formatScriptSummary, summarizeScript } from "./summary";

const SCRIPT = `Title: Test

INT. HALL - NIGHT

Mara enters.

MARA
Hello.

DEX (V.O.)
Hi.

@Mara
Again.

EXT. ROOF - DAY

DEX
Up here.
`;

describe("summarizeScript", () => {
  it("counts scenes, distinct characters and dialogue lines", () => {
    expect(summarizeScript(parseFountain(SCRIPT))).toEqual({ scenes: 2, characters: 2, dialogueLines: 4 });
  });
  it("handles an empty script", () => {
    expect(summarizeScript(parseFountain(""))).toEqual({ scenes: 0, characters: 0, dialogueLines: 0 });
  });
});

describe("formatScriptSummary", () => {
  it("uses plurals", () => {
    expect(formatScriptSummary({ scenes: 8, characters: 5, dialogueLines: 41 })).toBe("8 scenes · 5 characters · 41 dialogue lines");
  });
  it("uses singulars", () => {
    expect(formatScriptSummary({ scenes: 1, characters: 1, dialogueLines: 1 })).toBe("1 scene · 1 character · 1 dialogue line");
  });
});
