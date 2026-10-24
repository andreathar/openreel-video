import { describe, expect, it } from "vitest";
import type { Project } from "../types/project";
import { parseFountain } from "./fountain";
import {
  buildShotPrompt,
  getGenerationTarget,
  linkedTake,
  mergeProductionManifest,
  reconcileProductionManifests,
  registerTakeFile,
  parseProductionManifest,
  recordProductionTake,
  serializeProductionManifest,
  setTakeReview,
  suggestTargets,
  updateProductionShot,
  upsertProductionEntity,
  validateShotTarget,
  type ProductionManifest,
} from "./production";
import { planProduction } from "./shots";
import {
  SCRIPT_SCENE_MARKER_PREFIX,
  SCRIPT_SHOT_MEDIA_PREFIX,
  SCRIPT_SHOTS_TRACK_ID,
  applyProductionManifest,
  buildScriptTimeline,
  conformScriptTimeline,
  sceneRuntimes,
} from "./timeline-builder";

const SCRIPT = `Title: The Heist

INT. VAULT - NIGHT

Mara drops onto the marble floor and freezes as the laser grid sweeps past.

MARA
Three minutes.

EXT. ROOFTOP - CONTINUOUS

Dex waits by the rope.
`;

const plan = planProduction(parseFountain(SCRIPT), { projectCode: "HSTL", profileId: "kling-v4" });

function manifest(): ProductionManifest {
  return mergeProductionManifest(undefined, plan);
}

function emptyProject(): Project {
  return {
    id: "p1",
    name: "Test",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [] },
    timeline: { duration: 0, markers: [], subtitles: [], tracks: [] },
  } as unknown as Project;
}

describe("mergeProductionManifest", () => {
  it("creates shots and named entities from the breakdown", () => {
    const m = manifest();
    expect(m.shots.map((s) => s.id)[0]).toBe("HSTL_S001_SH01");
    expect(m.shots.every((s) => s.status === "todo" && s.targetId === "kling-v4-omni")).toBe(true);
    expect(m.entities.map((e) => e.code)).toEqual(expect.arrayContaining(["HSTL-CHR-MARA", "HSTL-LOC-VAULT"]));
    expect(m.shots[0].entities).toContain("HSTL-CHR-MARA");
  });

  it("keeps prompts, takes and element ids across a script rebuild", () => {
    let m = updateProductionShot(manifest(), "HSTL_S001_SH01", { prompt: "Mara lands, slow motion" });
    m = upsertProductionEntity(m, { kind: "CHR", displayName: "MARA", kling: { elementId: "123", type: "image" } });
    m = recordProductionTake(m, "HSTL_S002_SH01", { generationId: "gen-1" }).manifest;
    const rebuilt = mergeProductionManifest(m, planProduction(parseFountain(SCRIPT.replace("Dex waits by the rope.\n", "")), { projectCode: "HSTL", profileId: "kling-v4" }));
    const shot = rebuilt.shots.find((s) => s.id === "HSTL_S001_SH01");
    expect(shot?.prompt).toBe("Mara lands, slow motion");
    expect(shot?.status).toBe("prompted");
    expect(rebuilt.entities.find((e) => e.code === "HSTL-CHR-MARA")?.kling?.elementId).toBe("123");
    // The rooftop shot left the script but has a take, so it is kept as an orphan.
    const rooftop = rebuilt.shots.find((s) => s.id === "HSTL_S002_SH01");
    expect(rooftop?.takes).toHaveLength(1);
  });
});

describe("reference limits", () => {
  it("rejects a shot that exceeds the target's element budget", () => {
    let m = manifest();
    const codes: string[] = [];
    for (let i = 0; i < 8; i++) {
      m = upsertProductionEntity(m, { kind: "CHR", displayName: `EXTRA ${i}`, kling: { elementId: `e${i}`, type: "image" } });
      codes.push(m.entities[m.entities.length - 1].code);
    }
    m = updateProductionShot(m, "HSTL_S001_SH01", { entities: codes });
    const shot = m.shots[0];
    expect(validateShotTarget(shot, m, getGenerationTarget("kling-v4-omni"))).toContain("8 elements (max 7)");
  });

  it("requires a reference video for Genjutsu and suggests targets that fit", () => {
    let m = manifest();
    const shot = m.shots[0];
    expect(validateShotTarget(shot, m, getGenerationTarget("hf-genjutsu-motion"))).toContain("needs a reference video");
    m = updateProductionShot(m, shot.id, { refs: { images: ["refs/mara.png"], videos: ["refs/dance.mp4"], audios: [] } });
    const ids = suggestTargets(m.shots[0], m).map((t) => t.id);
    expect(ids).toContain("hf-genjutsu-motion");
    expect(ids).toContain("kling-v4-omni");
    expect(ids).not.toContain("hf-soul-2");
  });
});

describe("prompts and takes", () => {
  it("binds Kling elements into the prompt", () => {
    let m = upsertProductionEntity(manifest(), { kind: "CHR", displayName: "MARA", kling: { elementId: "777", type: "image" } });
    m = updateProductionShot(m, "HSTL_S001_SH01", { prompt: "Mara drops from the vent" });
    const payload = buildShotPrompt(m.shots[0], m, getGenerationTarget("kling-v4-omni"));
    expect(payload.prompt).toBe("<<<777>>> drops from the vent");
    expect(JSON.parse(payload.elements ?? "[]")).toEqual([{ id: "777", bindName: "MARA", type: "image" }]);
    expect(buildShotPrompt(m.shots[0], m, getGenerationTarget("hf-soul-2")).elements).toBeUndefined();
  });

  it("numbers takes per shot with the model tag", () => {
    let m = manifest();
    const first = recordProductionTake(m, "HSTL_S001_SH01", { generationId: "a" });
    m = first.manifest;
    const second = recordProductionTake(m, "HSTL_S001_SH01", { targetId: "hf-soul-2", generationId: "b" });
    expect(first.take.fileName).toBe("HSTL_S001_SH01_kl-v4_T01.mp4");
    expect(second.take.fileName).toBe("HSTL_S001_SH01_hf-soul2_T02.png");
    expect(second.manifest.shots[0].status).toBe("queued");
  });

  it("round-trips through production.json", () => {
    const m = recordProductionTake(manifest(), "HSTL_S001_SH01", { generationId: "a" }).manifest;
    expect(parseProductionManifest(serializeProductionManifest(m))).toEqual(m);
    expect(() => parseProductionManifest("{}")).toThrow();
  });
});

describe("timeline integration", () => {
  it("stores the manifest on build and mirrors status onto clips", () => {
    const built = buildScriptTimeline(emptyProject(), plan);
    expect(built.production?.shots).toHaveLength(built.timeline.tracks[0].clips.length);
    const updated = applyProductionManifest(built, updateProductionShot(built.production!, "HSTL_S001_SH01", { status: "approved" }));
    const clip = updated.timeline.tracks.find((t) => t.id === SCRIPT_SHOTS_TRACK_ID)!.clips[0];
    expect((clip.metadata?.script as { status: string }).status).toBe("approved");
    // Rebuilding keeps the status.
    const rebuilt = buildScriptTimeline(updated, plan);
    expect((rebuilt.timeline.tracks[0].clips[0].metadata?.script as { status: string }).status).toBe("approved");
  });
});

describe("folder sync", () => {
  it("registers take files by canonical name and ignores others", () => {
    const m = manifest();
    const found = registerTakeFile(m, "shots/S001/HSTL_S001_SH01_hf-gjm_T03.mp4");
    expect(found.changed).toBe(true);
    const shot = found.manifest.shots[0];
    expect(shot.status).toBe("generated");
    expect(shot.takes[0]).toEqual(expect.objectContaining({ take: 3, targetId: "hf-genjutsu-motion", status: "done" }));
    expect(linkedTake(shot)?.localPath).toBe("shots/S001/HSTL_S001_SH01_hf-gjm_T03.mp4");
    expect(registerTakeFile(found.manifest, "shots/S001/HSTL_S001_SH01_hf-gjm_T03.mp4").changed).toBe(false);
    expect(registerTakeFile(m, "random_video.mp4").changed).toBe(false);
    expect(registerTakeFile(m, "OTHER_S001_SH01_kl-v4_T01.mp4").changed).toBe(false);
  });

  it("completes a queued take when its file appears", () => {
    const queued = recordProductionTake(manifest(), "HSTL_S001_SH01", { generationId: "g1" }).manifest;
    const done = registerTakeFile(queued, "shots/S001/HSTL_S001_SH01_kl-v4_T01.mp4").manifest;
    expect(done.shots[0].takes).toHaveLength(1);
    expect(done.shots[0].takes[0]).toEqual(expect.objectContaining({ generationId: "g1", status: "done" }));
  });

  it("prefers the selected take", () => {
    let m = registerTakeFile(manifest(), "a/HSTL_S001_SH01_kl-v4_T01.mp4").manifest;
    m = registerTakeFile(m, "a/HSTL_S001_SH01_kl-v4_T02.mp4").manifest;
    expect(linkedTake(m.shots[0])?.take).toBe(2);
    m = updateProductionShot(m, "HSTL_S001_SH01", { selectedTake: 1 });
    expect(linkedTake(m.shots[0])?.take).toBe(1);
  });

  it("reconciles the project copy with production.json", () => {
    const base = manifest();
    const local = { ...updateProductionShot(base, "HSTL_S001_SH01", { prompt: "local prompt" }), updatedAt: 100 };
    let remote = recordProductionTake(base, "HSTL_S001_SH01", { generationId: "g1" }).manifest;
    remote = upsertProductionEntity(remote, { kind: "CHR", displayName: "MARA", kling: { elementId: "9", type: "image" } });
    remote = { ...remote, updatedAt: 200 };
    const merged = reconcileProductionManifests(local, remote);
    // Remote is newer, so its prompt (empty) wins, but no take or element id is lost either way.
    expect(merged.shots[0].takes[0].generationId).toBe("g1");
    expect(merged.entities.find((e) => e.code === "HSTL-CHR-MARA")?.kling?.elementId).toBe("9");
    const reverse = reconcileProductionManifests({ ...remote, updatedAt: 50 }, local);
    expect(reverse.shots[0].prompt).toBe("local prompt");
    expect(reverse.shots[0].takes[0].generationId).toBe("g1");
    expect(reverse.entities.find((e) => e.code === "HSTL-CHR-MARA")?.kling?.elementId).toBe("9");
  });
});

describe("conform to takes", () => {
  /** Built timeline with HSTL_S001_SH01 linked to a 12s take. */
  function linked(trim?: { trimIn?: number; trimOut?: number }) {
    let project = buildScriptTimeline(emptyProject(), plan);
    let production = registerTakeFile(project.production!, "shots/S001/HSTL_S001_SH01_kl-v4_T01.mp4").manifest;
    if (trim) {
      production = setTakeReview(production, "HSTL_S001_SH01", 1, { score: 6, issues: [], model: "test", reviewedAt: 1, ...trim });
    }
    project = applyProductionManifest(project, production);
    const mediaId = SCRIPT_SHOT_MEDIA_PREFIX + "HSTL_S001_SH01";
    const items = project.mediaLibrary.items.map((m) =>
      m.id === mediaId ? { ...m, isPlaceholder: false, metadata: { ...m.metadata, duration: 12 } } : m,
    );
    return { ...project, mediaLibrary: { items } };
  }
  const shots = (p: Project) => p.timeline.tracks.find((t) => t.id === SCRIPT_SHOTS_TRACK_ID)!.clips;

  it("uses the real take length and ripples later shots and scene markers", () => {
    const before = linked();
    const estimated = shots(before)[0].duration;
    const { project, conformed } = conformScriptTimeline(before);
    expect(conformed).toEqual(["HSTL_S001_SH01"]);
    const clips = shots(project);
    expect(clips[0]).toMatchObject({ duration: 12, inPoint: 0, outPoint: 12 });
    expect(clips[1].startTime).toBeCloseTo(shots(before)[1].startTime + 12 - estimated);
    for (let i = 1; i < clips.length; i++) expect(clips[i].startTime).toBeCloseTo(clips[i - 1].startTime + clips[i - 1].duration);
    const scene2 = project.timeline.markers.find((m) => m.id === SCRIPT_SCENE_MARKER_PREFIX + "S002");
    expect(scene2?.time).toBeCloseTo(clips.find((c) => (c.metadata?.script as { sceneCode: string }).sceneCode === "S002")!.startTime);
  });

  it("applies the review trim and reports per-scene drift", () => {
    const { project } = conformScriptTimeline(linked({ trimIn: 1.5, trimOut: 9 }));
    expect(shots(project)[0]).toMatchObject({ inPoint: 1.5, outPoint: 9, duration: 7.5 });
    const s1 = sceneRuntimes(project)[0];
    expect(s1.linked).toBe(1);
    expect(s1.actual - s1.estimated).toBeCloseTo(7.5 - shots(linked())[0].duration);
  });

  it("is a no-op when nothing is linked", () => {
    const project = buildScriptTimeline(emptyProject(), plan);
    expect(conformScriptTimeline(project)).toEqual({ project, conformed: [] });
  });
});
