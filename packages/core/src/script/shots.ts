import type { ScriptDocument, ScriptElement, ScriptScene } from "./fountain";
import { elementLines, elementSpeechSeconds, estimateScene, type SceneEstimate } from "./estimate";
import { normalizeProjectCode, sceneCode, shotId } from "./naming";

/** Duration rules of one generation model; shots are snapped to these. */
export interface ShotDurationProfile {
  readonly id: string;
  readonly label: string;
  readonly platform: "kling" | "higgsfield" | "generic";
  /** Short tag used in take file names, e.g. "kl-v3o". */
  readonly modelTag: string;
  readonly minSeconds: number;
  readonly maxSeconds: number;
  /** When set, only these durations are accepted by the model. */
  readonly allowedSeconds?: readonly number[];
  readonly defaultSeconds: number;
}

// Ranges from the platforms' model declarations (kling who_am_i, Higgsfield models_explore), 2026-10.
export const SHOT_DURATION_PROFILES: readonly ShotDurationProfile[] = [
  { id: "kling-v3-omni", label: "Kling 3.0 Omni", platform: "kling", modelTag: "kl-v3o", minSeconds: 3, maxSeconds: 15, defaultSeconds: 5 },
  { id: "kling-v4", label: "Kling 4.0", platform: "kling", modelTag: "kl-v4", minSeconds: 3, maxSeconds: 30, defaultSeconds: 8 },
  { id: "kling-v2-6", label: "Kling 2.6", platform: "kling", modelTag: "kl-v26", minSeconds: 5, maxSeconds: 10, allowedSeconds: [5, 10], defaultSeconds: 5 },
  // Genjutsu follows its reference video; Kling 4.0 Omni's 3–30s video reference range is used until Higgsfield publishes one.
  { id: "hf-genjutsu", label: "Higgsfield Genjutsu", platform: "higgsfield", modelTag: "hf-gjm", minSeconds: 3, maxSeconds: 30, defaultSeconds: 8 },
  { id: "hf-seedance-2", label: "Higgsfield Seedance 2.0", platform: "higgsfield", modelTag: "hf-sd2", minSeconds: 4, maxSeconds: 15, defaultSeconds: 5 },
  { id: "generic", label: "Generic (any model)", platform: "generic", modelTag: "gen", minSeconds: 1, maxSeconds: 60, defaultSeconds: 5 },
];

export const DEFAULT_SHOT_PROFILE_ID = "kling-v4";

export function getShotProfile(id: string): ShotDurationProfile {
  return SHOT_DURATION_PROFILES.find((p) => p.id === id) ?? SHOT_DURATION_PROFILES[0];
}

export function snapShotSeconds(seconds: number, profile: ShotDurationProfile): number {
  if (profile.allowedSeconds?.length) {
    return profile.allowedSeconds.reduce((best, s) => (Math.abs(s - seconds) < Math.abs(best - seconds) ? s : best));
  }
  return Math.min(profile.maxSeconds, Math.max(profile.minSeconds, Math.round(seconds)));
}

export interface PlannedShot {
  readonly id: string;
  readonly number: number;
  readonly seconds: number;
  /** Offset from the start of the scene. */
  readonly offset: number;
  /** Script excerpt this shot covers — the seed for its generation prompt. */
  readonly description: string;
  readonly characters: readonly string[];
  readonly dialogue: readonly { readonly character: string; readonly text: string }[];
}

export interface PlannedScene {
  readonly code: string;
  readonly sceneNumber: number;
  readonly scriptNumber: string;
  readonly heading: string;
  readonly location: string;
  readonly timeOfDay: string;
  readonly characters: readonly string[];
  readonly estimate: SceneEstimate;
  /** Sum of shot lengths; what the timeline actually uses. */
  readonly seconds: number;
  readonly shots: readonly PlannedShot[];
}

export interface ProductionBreakdown {
  readonly projectCode: string;
  readonly title?: string;
  readonly profileId: string;
  readonly scenes: readonly PlannedScene[];
  readonly characters: readonly string[];
  readonly locations: readonly string[];
  readonly totalSeconds: number;
}

const DESCRIPTION_LIMIT = 400;

function describe(elements: readonly ScriptElement[]): string {
  const text = elements
    .map((el) => (el.type === "dialogue" ? `${el.character}: ${el.text}` : el.type === "action" ? el.text.replace(/\n/g, " ") : ""))
    .filter(Boolean)
    .join(" ");
  return text.length > DESCRIPTION_LIMIT ? `${text.slice(0, DESCRIPTION_LIMIT - 1).trimEnd()}…` : text;
}

export function planSceneShots(
  scene: ScriptScene,
  sceneNumber: number,
  projectCode: string,
  profile: ShotDurationProfile,
): PlannedScene {
  const estimate = estimateScene(scene);
  const total = estimate.seconds;
  const longest = profile.allowedSeconds?.length ? Math.max(...profile.allowedSeconds) : profile.maxSeconds;
  const count = Math.max(1, Math.round(total / profile.defaultSeconds), Math.ceil(total / longest));
  const seconds = Array.from({ length: count }, () => snapShotSeconds(total / count, profile));

  // Place each script element on the shot that covers its midpoint.
  const weights = scene.elements.map((el) => Math.max((elementLines(el) / 55) * 60, elementSpeechSeconds(el)));
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
  const sceneLength = seconds.reduce((a, b) => a + b, 0);
  const buckets: ScriptElement[][] = seconds.map(() => []);
  let cursor = 0;
  scene.elements.forEach((el, idx) => {
    const span = (weights[idx] / weightSum) * sceneLength;
    const mid = cursor + span / 2;
    cursor += span;
    let acc = 0;
    let target = seconds.length - 1;
    for (let s = 0; s < seconds.length; s++) {
      acc += seconds[s];
      if (mid < acc) {
        target = s;
        break;
      }
    }
    buckets[target].push(el);
  });

  let offset = 0;
  const shots = seconds.map((len, idx) => {
    const els = buckets[idx];
    const dialogue = els.flatMap((el) => (el.type === "dialogue" ? [{ character: el.character, text: el.text }] : []));
    const shot: PlannedShot = {
      id: shotId(projectCode, sceneNumber, idx + 1),
      number: idx + 1,
      seconds: len,
      offset,
      description: describe(els) || (idx > 0 ? "(continues)" : scene.heading),
      characters: [...new Set(dialogue.map((d) => d.character))],
      dialogue,
    };
    offset += len;
    return shot;
  });

  return {
    code: sceneCode(sceneNumber),
    sceneNumber,
    scriptNumber: scene.number,
    heading: scene.heading,
    location: scene.location,
    timeOfDay: scene.timeOfDay,
    characters: scene.characters,
    estimate,
    seconds: sceneLength,
    shots,
  };
}

export function planProduction(
  doc: ScriptDocument,
  options: { projectCode: string; profileId?: string },
): ProductionBreakdown {
  const projectCode = normalizeProjectCode(options.projectCode);
  const profile = getShotProfile(options.profileId ?? DEFAULT_SHOT_PROFILE_ID);
  const scenes = doc.scenes.map((scene, idx) => planSceneShots(scene, idx + 1, projectCode, profile));
  return {
    projectCode,
    ...(doc.title ? { title: doc.title } : {}),
    profileId: profile.id,
    scenes,
    characters: doc.characters,
    locations: doc.locations,
    totalSeconds: scenes.reduce((sum, s) => sum + s.seconds, 0),
  };
}
