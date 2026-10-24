import type { Clip, Track } from "../types/timeline";
import type { Project } from "../types/project";
import { linkedTake } from "./production";
import type { ScriptShotClipMetadata } from "./timeline-builder";
import { SCRIPT_SHOTS_TRACK_ID } from "./timeline-builder";

/** Alternating dialogue tracks, so overlapping J/L cuts never collide. */
export const SCRIPT_DIALOGUE_TRACK_IDS = ["script-dialogue-a", "script-dialogue-b"] as const;

export interface AssembleDialogueOptions {
  /** How far (seconds) audio may lead or trail across a cut. Default 0.5. */
  readonly overlap?: number;
}

export interface AssembleDialogueResult {
  readonly project: Project;
  readonly placed: string[];
  readonly jCuts: string[];
  readonly lCuts: string[];
}

/** Speech closer than this to a cut counts as touching it. */
const EDGE = 0.3;

/**
 * Moves each shot's sound onto two alternating DIALOGUE tracks (audio-only
 * media from `audioMedia`, keyed by shot id) and mutes the picture clip.
 * Where a take has spare source and its speech touches a cut, the sound
 * crosses it: a J-cut when the line starts right at the incoming shot's
 * head, an L-cut when it runs to the outgoing shot's tail. Rebuilds the
 * dialogue tracks each time, so running it again after a conform is safe.
 */
export function assembleDialogue(
  project: Project,
  audioMedia: ReadonlyMap<string, string>,
  options: AssembleDialogueOptions = {},
): AssembleDialogueResult {
  const overlap = options.overlap ?? 0.5;
  const shotsTrack = project.timeline.tracks.find((t) => t.id === SCRIPT_SHOTS_TRACK_ID);
  if (!shotsTrack) return { project, placed: [], jCuts: [], lCuts: [] };

  const shots = new Map((project.production?.shots ?? []).map((s) => [s.id, s]));
  const durations = new Map(project.mediaLibrary.items.map((m) => [m.id, m.metadata?.duration ?? 0]));
  const clips = [...shotsTrack.clips].sort((a, b) => a.startTime - b.startTime);
  const lanes: Clip[][] = [[], []];
  const placed: string[] = [];
  const jCuts: string[] = [];
  const lCuts: string[] = [];
  const muted = new Set<string>();

  clips.forEach((clip, i) => {
    const shotId = (clip.metadata?.script as ScriptShotClipMetadata | undefined)?.shotId;
    const mediaId = shotId && audioMedia.get(shotId);
    if (!shotId || !mediaId) return;
    const speech = shots.get(shotId) && linkedTake(shots.get(shotId)!)?.speech;
    const sourceLength = durations.get(mediaId) || durations.get(clip.mediaId) || clip.outPoint;

    let start = clip.startTime;
    let inPoint = clip.inPoint;
    // An unconformed clip can be longer than its take; never play past the source.
    let outPoint = Math.min(clip.outPoint, sourceLength);
    const first = speech?.segments[0];
    const last = speech?.segments[speech.segments.length - 1];
    if (i > 0 && first && first.start - clip.inPoint < EDGE && clip.inPoint >= overlap) {
      start -= overlap;
      inPoint -= overlap;
      jCuts.push(shotId);
    }
    if (i < clips.length - 1 && last && clip.outPoint - last.end < EDGE && sourceLength - clip.outPoint >= overlap) {
      outPoint += overlap;
      lCuts.push(shotId);
    }

    const lane = placed.length % 2;
    lanes[lane].push({
      ...clip,
      id: `dialogue-${shotId}`,
      mediaId,
      trackId: SCRIPT_DIALOGUE_TRACK_IDS[lane],
      startTime: round(start),
      inPoint: round(inPoint),
      outPoint: round(outPoint),
      duration: round(outPoint - inPoint),
      effects: [],
      keyframes: [],
      volume: 1,
      metadata: { script: clip.metadata?.script, dialogueFor: clip.id },
    });
    muted.add(clip.id);
    placed.push(shotId);
  });

  const previous = new Map(project.timeline.tracks.map((t) => [t.id, t]));
  const dialogueTracks: Track[] = SCRIPT_DIALOGUE_TRACK_IDS.map((id, lane) => ({
    id,
    type: "audio",
    role: "dialogue",
    name: `DIALOGUE ${lane ? "B" : "A"}`,
    clips: lanes[lane],
    transitions: [],
    locked: previous.get(id)?.locked ?? false,
    hidden: previous.get(id)?.hidden ?? false,
    muted: previous.get(id)?.muted ?? false,
    solo: false,
  }));

  const tracks: Track[] = [];
  for (const track of project.timeline.tracks) {
    if ((SCRIPT_DIALOGUE_TRACK_IDS as readonly string[]).includes(track.id)) continue;
    if (track.id !== SCRIPT_SHOTS_TRACK_ID) {
      tracks.push(track);
      continue;
    }
    tracks.push({ ...track, clips: track.clips.map((c) => (muted.has(c.id) ? { ...c, volume: 0 } : c)) });
    if (placed.length) tracks.push(...dialogueTracks);
  }

  return {
    project: { ...project, modifiedAt: Date.now(), timeline: { ...project.timeline, tracks } },
    placed,
    jCuts,
    lCuts,
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
