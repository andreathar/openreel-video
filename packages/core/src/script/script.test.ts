import { describe, expect, it } from "vitest";
import type { Project } from "../types/project";
import { estimateScene, formatEighths } from "./estimate";
import { parseFountain } from "./fountain";
import {
  deriveProjectCode,
  elementName,
  parseProductionName,
  shotId,
  takeFileName,
} from "./naming";
import { getShotProfile, planProduction, snapShotSeconds } from "./shots";
import {
  SCRIPT_SHOT_MEDIA_PREFIX,
  SCRIPT_SHOTS_TRACK_ID,
  buildScriptTimeline,
} from "./timeline-builder";

const SCRIPT = `Title: The Heist
Author: Someone

FADE IN:

INT. VAULT - NIGHT

Mara slides through the vent and drops silently onto the marble floor.

MARA
(whispering)
Three minutes. That's all we get.

JONAS (V.O.)
Then stop talking.

/* cut this later */
[[note: add alarm sfx]]

CUT TO:

EXT. ROOFTOP - CONTINUOUS #12A#

Wind howls. Jonas checks his watch.

.FLASHBACK

@McCLANE
Yippee.
`;

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

describe("parseFountain", () => {
  const doc = parseFountain(SCRIPT);

  it("reads the title page", () => {
    expect(doc.title).toBe("The Heist");
    expect(doc.titlePage.Author ?? doc.titlePage.author).toBe("Someone");
  });

  it("splits scenes on headings, forced headings and scene numbers", () => {
    expect(doc.scenes.map((s) => s.heading)).toEqual([
      "INT. VAULT - NIGHT",
      "EXT. ROOFTOP - CONTINUOUS",
      "FLASHBACK",
    ]);
    expect(doc.scenes[0].intExt).toBe("INT");
    expect(doc.scenes[0].location).toBe("VAULT");
    expect(doc.scenes[0].timeOfDay).toBe("NIGHT");
    expect(doc.scenes[1].number).toBe("12A");
  });

  it("parses dialogue with extensions and parentheticals, skipping notes", () => {
    const dialogue = doc.scenes[0].elements.filter((e) => e.type === "dialogue");
    expect(dialogue).toHaveLength(2);
    expect(dialogue[0]).toMatchObject({ character: "MARA", parenthetical: "whispering" });
    expect(dialogue[1]).toMatchObject({ character: "JONAS", extension: "V.O." });
    const text = JSON.stringify(doc.scenes[0].elements);
    expect(text).not.toContain("cut this later");
    expect(text).not.toContain("alarm sfx");
  });

  it("collects characters, including forced ones", () => {
    expect(doc.characters).toContain("MARA");
    expect(doc.characters).toContain("JONAS");
    expect(doc.characters).toContain("McCLANE");
    expect(doc.locations).toContain("VAULT");
  });

  it("puts content before the first heading into a cold open", () => {
    const cold = parseFountain("A man walks.\n\nINT. ROOM - DAY\n\nHe sits.");
    expect(cold.scenes[0].heading).toBe("COLD OPEN");
    expect(cold.scenes).toHaveLength(2);
  });
});

describe("estimateScene", () => {
  it("never goes under the minimum and reports eighths", () => {
    const est = estimateScene({ elements: [{ type: "action", text: "Bang." }] });
    expect(est.seconds).toBeGreaterThanOrEqual(3);
    expect(est.eighths).toBeGreaterThanOrEqual(1);
  });

  it("gives long dialogue enough time to be spoken", () => {
    const words = Array.from({ length: 140 }, () => "word").join(" ");
    const est = estimateScene({ elements: [{ type: "dialogue", character: "A", text: words }] });
    expect(est.seconds).toBeGreaterThanOrEqual(60);
  });

  it("formats eighths like a stripboard", () => {
    expect(formatEighths(3)).toBe("3/8");
    expect(formatEighths(8)).toBe("1");
    expect(formatEighths(11)).toBe("1 3/8");
  });
});

describe("naming", () => {
  it("derives short project codes", () => {
    expect(deriveProjectCode("Heist")).toBe("HEIS");
    expect(deriveProjectCode("The Last Train Home")).toBe("TLTH");
  });

  it("builds and parses shot and take names", () => {
    expect(shotId("hstl", 12, 3)).toBe("HSTL_S012_SH03");
    const file = takeFileName({ projectCode: "HSTL", sceneNumber: 12, shotNumber: 3, modelTag: "kl-v4", take: 2, extension: "mp4" });
    expect(file).toBe("HSTL_S012_SH03_kl-v4_T02.mp4");
    expect(parseProductionName(file)).toMatchObject({ projectCode: "HSTL", sceneNumber: 12, shotNumber: 3, modelTag: "kl-v4", take: 2 });
    expect(parseProductionName("HSTL_S012_SH03")).toMatchObject({ sceneNumber: 12, shotNumber: 3 });
    expect(parseProductionName("kling_20261024_abc.mp4")).toBeNull();
  });

  it("keeps element names within the platform limit", () => {
    expect(elementName("HSTL", "CHR", "Mara Vex")).toBe("HSTL-CHR-MARA-VEX");
    expect(elementName("HSTL", "LOC", "a".repeat(80)).length).toBeLessThanOrEqual(32);
  });
});

describe("planProduction", () => {
  const doc = parseFountain(SCRIPT);

  it("snaps shots to the model's allowed durations", () => {
    expect(snapShotSeconds(7, getShotProfile("kling-v2-6"))).toBe(5);
    expect(snapShotSeconds(8, getShotProfile("kling-v2-6"))).toBe(10);
    expect(snapShotSeconds(40, getShotProfile("kling-v3-omni"))).toBe(15);
  });

  it("names every shot and keeps scene length equal to its shots", () => {
    const plan = planProduction(doc, { projectCode: "HSTL" });
    expect(plan.scenes).toHaveLength(3);
    for (const scene of plan.scenes) {
      expect(scene.shots.length).toBeGreaterThan(0);
      expect(scene.seconds).toBe(scene.shots.reduce((sum, s) => sum + s.seconds, 0));
      for (const shot of scene.shots) {
        expect(parseProductionName(shot.id)?.sceneNumber).toBe(scene.sceneNumber);
        expect(shot.seconds).toBeGreaterThanOrEqual(3);
        expect(shot.seconds).toBeLessThanOrEqual(30);
      }
    }
    expect(plan.scenes[0].shots[0].id).toBe("HSTL_S001_SH01");
    expect(plan.totalSeconds).toBe(plan.scenes.reduce((sum, s) => sum + s.seconds, 0));
  });

  it("splits long scenes into several shots", () => {
    const long = parseFountain(`INT. HALL - DAY\n\n${Array.from({ length: 30 }, (_, i) => `Beat ${i}: something long happens in the hall again and again.`).join("\n\n")}`);
    const plan = planProduction(long, { projectCode: "LONG" });
    expect(plan.scenes[0].shots.length).toBeGreaterThan(1);
  });
});

describe("buildScriptTimeline", () => {
  const plan = planProduction(parseFountain(SCRIPT), { projectCode: "HSTL" });

  it("creates scene markers and a SHOTS track of placeholders", () => {
    const project = buildScriptTimeline(emptyProject(), plan);
    const track = project.timeline.tracks[0];
    expect(track.id).toBe(SCRIPT_SHOTS_TRACK_ID);
    const shotCount = plan.scenes.reduce((n, s) => n + s.shots.length, 0);
    expect(track.clips).toHaveLength(shotCount);
    expect(project.mediaLibrary.items).toHaveLength(shotCount);
    expect(project.mediaLibrary.items.every((m) => m.isPlaceholder)).toBe(true);
    expect(project.timeline.markers.filter((m) => m.kind === "scene")).toHaveLength(3);
    expect(project.timeline.markers[1].time).toBe(plan.scenes[0].seconds);
    expect(project.timeline.duration).toBe(plan.totalSeconds);
    // Clips are contiguous.
    track.clips.reduce((end, clip) => {
      expect(clip.startTime).toBeCloseTo(end);
      return clip.startTime + clip.duration;
    }, 0);
  });

  it("stores the source script in the production manifest", () => {
    expect(buildScriptTimeline(emptyProject(), plan, { script: SCRIPT }).production?.script).toBe(SCRIPT);
    expect(buildScriptTimeline(emptyProject(), plan).production && "script" in buildScriptTimeline(emptyProject(), plan).production!).toBe(false);
  });

  it("rebuilds without duplicating and keeps relinked takes", () => {
    const first = buildScriptTimeline(emptyProject(), plan);
    const relinkedId = SCRIPT_SHOT_MEDIA_PREFIX + plan.scenes[0].shots[0].id;
    const relinked: Project = {
      ...first,
      mediaLibrary: {
        items: first.mediaLibrary.items.map((m) => (m.id === relinkedId ? { ...m, isPlaceholder: false } : m)),
      },
    };
    const second = buildScriptTimeline(relinked, plan);
    expect(second.timeline.tracks.filter((t) => t.id === SCRIPT_SHOTS_TRACK_ID)).toHaveLength(1);
    expect(second.timeline.markers).toHaveLength(first.timeline.markers.length);
    expect(second.mediaLibrary.items).toHaveLength(first.mediaLibrary.items.length);
    expect(second.mediaLibrary.items.find((m) => m.id === relinkedId)?.isPlaceholder).toBe(false);
  });
});
