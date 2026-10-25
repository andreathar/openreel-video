import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFountain } from "./fountain";

interface Row {
  id: string;
  category: string;
  fountain: string;
  expected_types: string[];
}

const rows: Row[] = readFileSync(new URL("./__fixtures__/inkwell-cases.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as Row);

/** id -> reason the parser's output differs from the fixture. Each must still fail. */
const KNOWN_GAPS: Record<string, string> = {
  "automatic-transition-a": "parser drops a script whose only content before the heading is a transition (transition-only cold open is not a scene)",
  "automatic-transition-b": "first line `KEY:` is read as a title-page entry, so the document body is empty",
  "forced-transition-b": "forced `>` transition alone makes a transition-only cold open, which the parser drops",
  "forced-scene-transition-a": "forced `>` transition alone makes a transition-only cold open, which the parser drops",
};

/** One type per non-blank source line, derived from the parsed elements and the source text. */
function lineTypes(fountain: string): string[] {
  const lines = fountain.replace(/\r\n?/g, "\n").split("\n");
  let p = 0;
  const skipBlank = () => {
    while (p < lines.length && lines[p].trim() === "") p++;
  };
  const out: string[] = [];
  const doc = parseFountain(fountain);
  for (const scene of doc.scenes) {
    if (scene.heading !== "COLD OPEN" || scene.number !== String(scene.index)) {
      skipBlank();
      out.push("Scene Heading");
      p++;
    }
    for (const el of scene.elements) {
      skipBlank();
      if (el.type === "transition") {
        out.push("Transition");
        p++;
      } else if (el.type === "action") {
        for (const _ of el.text.split("\n")) {
          out.push("Action");
          p++;
        }
      } else {
        out.push("Character");
        p++;
        while (p < lines.length && lines[p].trim() !== "") {
          out.push(/^\s*\(.*\)\s*$/.test(lines[p]) ? "Parenthetical" : "Dialogue");
          p++;
        }
      }
    }
  }
  return out;
}

const active = rows.filter((r) => r.category !== "unsupported");

describe("Inkwell Fountain edge cases", () => {
  it("loads 48 rows", () => {
    expect(rows).toHaveLength(48);
  });

  for (const row of active.filter((r) => !(r.id in KNOWN_GAPS))) {
    it(`${row.id}`, () => {
      expect(lineTypes(row.fountain)).toEqual(row.expected_types);
    });
  }

  for (const [id, reason] of Object.entries(KNOWN_GAPS)) {
    it(`known gap still fails: ${id} (${reason})`, () => {
      const row = active.find((r) => r.id === id);
      expect(row, `unknown id ${id}`).toBeDefined();
      expect(lineTypes(row!.fountain)).not.toEqual(row!.expected_types);
    });
  }
});
