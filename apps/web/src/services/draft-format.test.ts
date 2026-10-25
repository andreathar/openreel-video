import { describe, expect, it } from "vitest";
import { classifyLines, labelsFromRules, type DraftLine, type StructuredPrompt } from "@openreel/core";
import { connectionReady, formatDraft } from "./draft-format";
import type { DirectConnection } from "./agent/direct-llm-transport";

const conn = (over: Partial<DirectConnection> = {}): DirectConnection => ({
  provider: "openai", baseUrl: "https://api.example.com/v1", model: "m", apiKey: "k", ...over,
});

const FOUNTAIN = "INT. KITCHEN - DAY\n\nMARA\nHello there.\n\nEXT. STREET - NIGHT\n\nShe walks.\n";
const PROSE = "Mara walked into the kitchen and said hello.\n\nThen she left for the street.\n";
// Unterminated action lines are unconfident, so the draft is a screenplay that needs the model.
const scenes = (n: number) =>
  Array.from({ length: n }, (_, i) => `INT. ROOM ${i + 1} - DAY\n\nMara walks in ${i + 1}\n\nMARA\nLine ${i + 1}.\n`).join("\n");

/** Stands in for the model by answering with the rules' own labels. */
const emptyReply = "";
const rulesReply = (prompt: StructuredPrompt): string => {
  const lines: DraftLine[] = [];
  for (const row of prompt.user.split("\n")) {
    const m = /^(\d+)\|(?: (.*))?$/.exec(row);
    if (m) lines.push({ n: Number(m[1]), text: m[2] ?? "" });
  }
  return JSON.stringify(labelsFromRules(classifyLines(lines)));
};

describe("connectionReady", () => {
  it("requires a key for openai and anthropic, a base URL for compatible", () => {
    expect(connectionReady(conn({ apiKey: "" }))).toBe(false);
    expect(connectionReady(conn({ provider: "anthropic", apiKey: " " }))).toBe(false);
    expect(connectionReady(conn({ provider: "anthropic" }))).toBe(true);
    expect(connectionReady(conn({ provider: "compatible", apiKey: "", baseUrl: "http://localhost:1234/v1" }))).toBe(true);
    expect(connectionReady(conn({ provider: "compatible", apiKey: "k", baseUrl: "" }))).toBe(false);
  });
});

describe("formatDraft", () => {
  it("makes no model call for Fountain input", async () => {
    let calls = 0;
    const out = await formatDraft(FOUNTAIN, conn(), { cache: new Map(), request: async () => { calls++; return emptyReply; } });
    expect(calls).toBe(0);
    expect(out.kind).toBe("done");
    expect(out.conversion.kind).toBe("fountain");
  });

  it("returns the needs-ai notice for prose without a ready connection", async () => {
    let calls = 0;
    const out = await formatDraft(PROSE, conn({ apiKey: "" }), { cache: new Map(), request: async () => { calls++; return emptyReply; } });
    expect(calls).toBe(0);
    expect(out).toMatchObject({ kind: "done", notice: "needs-ai" });
  });

  it("runs three chunks in parallel for anthropic and one at a time otherwise", async () => {
    const run = async (provider: DirectConnection["provider"]) => {
      let active = 0, peak = 0;
      await formatDraft(scenes(3), conn({ provider }), {
        cache: new Map(), chunkLines: 6,
        request: async (p: StructuredPrompt) => {
          active++; peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 10));
          active--;
          return rulesReply(p);
        },
      });
      return peak;
    };
    expect(await run("anthropic")).toBe(3);
    expect(await run("openai")).toBe(1);
  });

  it("keeps the rule result and reports a formatted error when the endpoint fails", async () => {
    let calls = 0;
    const out = await formatDraft(scenes(2), conn(), {
      cache: new Map(), chunkLines: 6,
      request: async () => { calls++; throw new Error("401 Unauthorized"); },
    });
    expect(out.kind).toBe("error");
    if (out.kind !== "error") return;
    expect(out.title).toBe("Authentication failed");
    expect(out.conversion.fountain).toContain("INT. ROOM 1");
    expect(calls).toBe(1);
  });

  it("reuses the cache on a second call", async () => {
    let calls = 0;
    const cache = new Map();
    const request = async (p: StructuredPrompt) => { calls++; return rulesReply(p); };
    await formatDraft(PROSE, conn(), { cache, request });
    const first = calls;
    expect(first).toBeGreaterThan(0);
    await formatDraft(PROSE, conn(), { cache, request });
    expect(calls).toBe(first);
  });

  it("rethrows aborts", async () => {
    const ac = new AbortController();
    await expect(formatDraft(PROSE, conn(), {
      cache: new Map(), signal: ac.signal,
      request: async () => { ac.abort(); throw new DOMException("aborted", "AbortError"); },
    })).rejects.toMatchObject({ name: "AbortError" });
  });
});
