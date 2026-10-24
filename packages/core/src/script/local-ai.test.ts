import { describe, expect, it } from "vitest";
import {
  buildReferenceNamingPrompt,
  buildTakeReviewPrompt,
  extractJsonObject,
  parseReferenceNaming,
  parseTakeReview,
  toOpenAIMessages,
} from "./local-ai";
import { setTakeReview, reconcileProductionManifests, type ProductionManifest } from "./production";

const manifest: ProductionManifest = {
  version: 1,
  projectCode: "TH",
  defaultTargetId: "kling-v4-omni",
  entities: [{ code: "TH-CHR-MARA", kind: "CHR", displayName: "Mara", description: "thief in black", refs: [] }],
  shots: [
    {
      id: "TH_S001_SH01",
      sceneCode: "S001",
      heading: "INT. VAULT - NIGHT",
      seconds: 8,
      description: "Mara drops onto the floor.",
      entities: ["TH-CHR-MARA"],
      refs: { images: [], videos: [], audios: [] },
      targetId: "kling-v4-omni",
      prompt: "",
      status: "generated",
      takes: [{ take: 1, targetId: "kling-v4-omni", fileName: "TH_S001_SH01_kl-v4_T01.mp4", prompt: "", submittedAt: 1, status: "done" }],
    },
  ],
  updatedAt: 1,
};

describe("extractJsonObject", () => {
  it("finds JSON inside fences, prose and think blocks", () => {
    expect(extractJsonObject('<think>{"x":1}</think>Sure!\n```json\n{"kind":"CHR","label":"a {b}"}\n```')).toEqual({
      kind: "CHR",
      label: "a {b}",
    });
    expect(extractJsonObject("no json here")).toBeNull();
  });
});

describe("parseReferenceNaming", () => {
  it("clamps invented kinds and unknown tags", () => {
    const n = parseReferenceNaming('{"kind":"APP","label":"Editing Software!","description":" A  screen. ","tags":["Apps"]}', manifest);
    expect(n).toMatchObject({ kind: "PRP", label: "Editing Software", description: "A screen.", tags: ["Items"] });
  });

  it("files a new view under an existing entity", () => {
    const n = parseReferenceNaming('{"kind":"CHR","label":"Woman","existing":"th-chr-mara","tags":["characters"]}', manifest);
    expect(n).toMatchObject({ kind: "CHR", label: "Mara", existingCode: "TH-CHR-MARA", tags: ["Characters"] });
  });

  it("falls back to the file name when the output is unusable", () => {
    const n = parseReferenceNaming("I cannot tell.", manifest, "refs/inbox/old_rooftop_v2.png");
    expect(n).toMatchObject({ kind: "LOC", label: "old rooftop", tags: ["Scenes"] });
  });

  it("lists known entities and the image in the prompt", () => {
    const msgs = buildReferenceNamingPrompt(manifest, "data:image/jpeg;base64,AA", "a.png");
    expect(msgs[1].text).toContain("TH-CHR-MARA: Mara");
    const wire = toOpenAIMessages(msgs) as { content: unknown }[];
    expect(wire[1].content).toEqual([
      { type: "text", text: msgs[1].text },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AA" } },
    ]);
  });
});

describe("take review", () => {
  it("parses score, issues and trims within the take", () => {
    const r = parseTakeReview('{"score":7.6,"issues":["hand warps at end",""],"trimIn":0,"trimOut":6.43}', "qwen", 8, 5);
    expect(r).toEqual({ score: 8, issues: ["hand warps at end"], trimOut: 6.4, model: "qwen", reviewedAt: 5 });
  });

  it("flags unreadable output", () => {
    expect(parseTakeReview("??", "qwen", 8, 5)).toMatchObject({ score: 0, issues: ["review unreadable"] });
  });

  it("drops inverted trims", () => {
    expect(parseTakeReview('{"score":5,"trimIn":6,"trimOut":2}', "m", 8, 1)).not.toHaveProperty("trimIn");
  });

  it("puts references before frames", () => {
    const msgs = buildTakeReviewPrompt({
      shot: manifest.shots[0],
      entities: manifest.entities,
      frames: [{ time: 0.5, dataUri: "f1" }, { time: 4, dataUri: "f2" }],
      entityImages: ["r1"],
    });
    expect(msgs[1].images).toEqual(["r1", "f1", "f2"]);
    expect(msgs[1].text).toContain("frame 2 = 4.0s");
  });

  it("stores reviews and keeps the newest when merging", () => {
    const a = setTakeReview(manifest, "TH_S001_SH01", 1, { score: 4, issues: [], model: "m", reviewedAt: 10 });
    const b = { ...setTakeReview(manifest, "TH_S001_SH01", 1, { score: 9, issues: [], model: "m", reviewedAt: 20 }), updatedAt: 0 };
    expect(reconcileProductionManifests(a, b).shots[0].takes[0].review?.score).toBe(9);
    expect(() => setTakeReview(manifest, "TH_S001_SH01", 3, a.shots[0].takes[0].review!)).toThrow("Unknown take");
  });
});
