import type { MediaItem, Project } from "../types/project";
import type { Clip, Marker, Track } from "../types/timeline";
import type { PlannedScene, PlannedShot, ProductionBreakdown } from "./shots";
import { linkedTake, mergeProductionManifest, type ProductionManifest, type ShotStatus } from "./production";

/**
 * Turns a production breakdown into timeline content: one scene-range marker
 * per scene and a SHOTS track of placeholder clips named by shot id. The
 * result is a new Project; apply it with `project/applyEditSnapshot` so the
 * whole build is one undo step.
 */

export const SCRIPT_SHOTS_TRACK_ID = "script-shots";
export const SCRIPT_SCENE_MARKER_PREFIX = "script-scene-";
export const SCRIPT_SHOT_MEDIA_PREFIX = "script-shot-";

const SCENE_COLORS = ["#f59e0b", "#3b82f6", "#10b981", "#ef4444", "#8b5cf6", "#ec4899"];

export interface ScriptShotClipMetadata {
  readonly sceneCode: string;
  readonly shotId: string;
  readonly heading: string;
  readonly description: string;
  readonly characters: readonly string[];
  readonly status: ShotStatus;
}

export interface BuildScriptTimelineOptions {
  /** Timeline position of the first scene. Defaults to 0. */
  readonly startTime?: number;
  /** Optional slate image per shot (data URL), shown in the media library. */
  readonly thumbnailFor?: (shot: PlannedShot, scene: PlannedScene) => string | null;
  /** Generation target for shots new to the production manifest. */
  readonly defaultTargetId?: string;
}

function placeholderMedia(shot: PlannedShot, thumbnailUrl: string | null): MediaItem {
  return {
    id: SCRIPT_SHOT_MEDIA_PREFIX + shot.id,
    name: shot.id,
    type: "video",
    fileHandle: null,
    blob: null,
    metadata: { duration: shot.seconds, width: 0, height: 0, frameRate: 0, codec: "", sampleRate: 0, channels: 0, fileSize: 0 },
    thumbnailUrl,
    waveformData: null,
    isPlaceholder: true,
  };
}

function shotClip(shot: PlannedShot, scene: PlannedScene, startTime: number, status: ShotStatus): Clip {
  const script: ScriptShotClipMetadata = {
    sceneCode: scene.code,
    shotId: shot.id,
    heading: scene.heading,
    description: shot.description,
    characters: shot.characters,
    status,
  };
  return {
    id: `clip-${shot.id}`,
    mediaId: SCRIPT_SHOT_MEDIA_PREFIX + shot.id,
    trackId: SCRIPT_SHOTS_TRACK_ID,
    startTime,
    duration: shot.seconds,
    inPoint: 0,
    outPoint: shot.seconds,
    effects: [],
    audioEffects: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1, fitMode: "contain" },
    volume: 1,
    keyframes: [],
    metadata: { script },
  };
}

/**
 * Builds (or rebuilds) the script timeline. Earlier script markers and the
 * SHOTS track are replaced; shot media that was already relinked to a real
 * file is kept so finished takes survive a rebuild.
 */
export function buildScriptTimeline(
  project: Project,
  breakdown: ProductionBreakdown,
  options: BuildScriptTimelineOptions = {},
): Project {
  let time = options.startTime ?? 0;
  const production = mergeProductionManifest(project.production, breakdown, options.defaultTargetId);
  const statusOf = new Map(production.shots.map((s) => [s.id, s.status]));
  const markers: Marker[] = [];
  const clips: Clip[] = [];
  const keptMedia = project.mediaLibrary.items.filter(
    (item) => !(item.id.startsWith(SCRIPT_SHOT_MEDIA_PREFIX) && item.isPlaceholder),
  );
  const existingIds = new Set(keptMedia.map((item) => item.id));
  const newMedia: MediaItem[] = [];

  breakdown.scenes.forEach((scene, idx) => {
    markers.push({
      id: SCRIPT_SCENE_MARKER_PREFIX + scene.code,
      time,
      duration: scene.seconds,
      kind: "scene",
      label: `${scene.code} · ${scene.heading}`,
      color: SCENE_COLORS[idx % SCENE_COLORS.length],
    });
    for (const shot of scene.shots) {
      clips.push(shotClip(shot, scene, time + shot.offset, statusOf.get(shot.id) ?? "todo"));
      if (!existingIds.has(SCRIPT_SHOT_MEDIA_PREFIX + shot.id)) {
        newMedia.push(placeholderMedia(shot, options.thumbnailFor?.(shot, scene) ?? null));
      }
    }
    time += scene.seconds;
  });

  const previousTrack = project.timeline.tracks.find((t) => t.id === SCRIPT_SHOTS_TRACK_ID);
  const track: Track = {
    id: SCRIPT_SHOTS_TRACK_ID,
    type: "video",
    role: "general",
    name: `SHOTS · ${breakdown.projectCode}`,
    clips,
    transitions: [],
    locked: previousTrack?.locked ?? false,
    hidden: previousTrack?.hidden ?? false,
    muted: previousTrack?.muted ?? false,
    solo: false,
  };
  const tracks = previousTrack
    ? project.timeline.tracks.map((t) => (t.id === SCRIPT_SHOTS_TRACK_ID ? track : t))
    : [track, ...project.timeline.tracks];

  const otherMarkers = project.timeline.markers.filter((m) => !m.id.startsWith(SCRIPT_SCENE_MARKER_PREFIX));
  const otherEnd = tracks
    .filter((t) => t.id !== SCRIPT_SHOTS_TRACK_ID)
    .flatMap((t) => t.clips)
    .reduce((end, c) => Math.max(end, c.startTime + c.duration), 0);

  return {
    ...project,
    modifiedAt: Date.now(),
    mediaLibrary: { items: [...keptMedia, ...newMedia] },
    production,
    timeline: {
      ...project.timeline,
      tracks,
      markers: [...otherMarkers, ...markers].sort((a, b) => a.time - b.time),
      duration: Math.max(otherEnd, time),
    },
  };
}

/**
 * Stores an updated production manifest on the project and mirrors each
 * shot's status onto its SHOTS clip, so the timeline shows progress.
 */
export function applyProductionManifest(project: Project, production: ProductionManifest): Project {
  const statusOf = new Map(production.shots.map((s) => [s.id, s.status]));
  const tracks = project.timeline.tracks.map((track) => {
    if (track.id !== SCRIPT_SHOTS_TRACK_ID) return track;
    return {
      ...track,
      clips: track.clips.map((clip) => {
        const script = clip.metadata?.script as ScriptShotClipMetadata | undefined;
        const status = script && statusOf.get(script.shotId);
        return script && status && status !== script.status
          ? { ...clip, metadata: { ...clip.metadata, script: { ...script, status } } }
          : clip;
      }),
    };
  });
  return { ...project, modifiedAt: Date.now(), production, timeline: { ...project.timeline, tracks } };
}

export interface SceneRuntime {
  readonly sceneCode: string;
  readonly heading: string;
  /** Sum of the planned shot lengths (script estimate). */
  readonly estimated: number;
  /** Sum of the SHOTS clip lengths currently on the timeline. */
  readonly actual: number;
  readonly shots: number;
  /** Shots whose clip shows a real take instead of a placeholder. */
  readonly linked: number;
}

/** Estimated vs actual runtime per scene, in script order. */
export function sceneRuntimes(project: Project): SceneRuntime[] {
  const production = project.production;
  const track = project.timeline.tracks.find((t) => t.id === SCRIPT_SHOTS_TRACK_ID);
  if (!production || !track) return [];
  const clipOf = new Map(track.clips.map((c) => [(c.metadata?.script as ScriptShotClipMetadata | undefined)?.shotId, c]));
  const placeholder = new Set(project.mediaLibrary.items.filter((m) => m.isPlaceholder).map((m) => m.id));
  const scenes = new Map<string, { heading: string; estimated: number; actual: number; shots: number; linked: number }>();
  for (const shot of production.shots) {
    if (shot.orphaned) continue;
    const scene = scenes.get(shot.sceneCode) ?? { heading: shot.heading, estimated: 0, actual: 0, shots: 0, linked: 0 };
    const clip = clipOf.get(shot.id);
    scene.estimated += shot.seconds;
    scene.actual += clip?.duration ?? 0;
    scene.shots++;
    if (clip && !placeholder.has(clip.mediaId)) scene.linked++;
    scenes.set(shot.sceneCode, scene);
  }
  return [...scenes].map(([sceneCode, s]) => ({
    sceneCode,
    ...s,
    estimated: round(s.estimated),
    actual: round(s.actual),
  }));
}

export interface ConformResult {
  readonly project: Project;
  /** Shots whose clip length or trim changed. */
  readonly conformed: readonly string[];
}

/**
 * Fits the SHOTS track to the real takes: each clip showing a downloaded take
 * gets that take's length, trimmed to the review's usable range when one was
 * suggested; placeholders keep their planned length. Clips are then laid end
 * to end in their current order and the scene markers follow, so the timeline
 * shows the film's actual runtime. Other tracks are not touched.
 */
export function conformScriptTimeline(project: Project): ConformResult {
  const track = project.timeline.tracks.find((t) => t.id === SCRIPT_SHOTS_TRACK_ID);
  if (!track || track.clips.length === 0) return { project, conformed: [] };
  const media = new Map(project.mediaLibrary.items.map((m) => [m.id, m]));
  const shots = new Map((project.production?.shots ?? []).map((s) => [s.id, s]));
  const ordered = [...track.clips].sort((a, b) => a.startTime - b.startTime);
  const conformed: string[] = [];
  const sceneRanges = new Map<string, { start: number; end: number }>();
  let cursor = ordered[0].startTime;
  const clips = ordered.map((clip) => {
    const script = clip.metadata?.script as ScriptShotClipMetadata | undefined;
    const item = media.get(clip.mediaId);
    const length = item && !item.isPlaceholder ? item.metadata.duration : 0;
    let { inPoint, outPoint } = clip;
    if (script && length > 0) {
      const shot = shots.get(script.shotId);
      const review = shot && linkedTake(shot)?.review;
      inPoint = Math.min(review?.trimIn ?? 0, length);
      outPoint = Math.min(review?.trimOut ?? length, length);
      if (outPoint <= inPoint) [inPoint, outPoint] = [0, length];
    }
    const duration = round(outPoint - inPoint);
    const changed = clip.startTime !== cursor || clip.inPoint !== inPoint || clip.outPoint !== outPoint || clip.duration !== duration;
    if (changed && script && (clip.duration !== duration || clip.inPoint !== inPoint)) conformed.push(script.shotId);
    const next: Clip = changed ? { ...clip, startTime: round(cursor), inPoint, outPoint, duration } : clip;
    if (script) {
      const range = sceneRanges.get(script.sceneCode);
      sceneRanges.set(script.sceneCode, { start: range?.start ?? next.startTime, end: next.startTime + duration });
    }
    cursor += duration;
    return next;
  });
  const unchanged = clips.every((c, i) => c === ordered[i]);
  if (unchanged) return { project, conformed: [] };
  const markers = project.timeline.markers.map((marker) => {
    const range = marker.id.startsWith(SCRIPT_SCENE_MARKER_PREFIX)
      ? sceneRanges.get(marker.id.slice(SCRIPT_SCENE_MARKER_PREFIX.length))
      : undefined;
    return range ? { ...marker, time: round(range.start), duration: round(range.end - range.start) } : marker;
  });
  const tracks = project.timeline.tracks.map((t) => (t.id === SCRIPT_SHOTS_TRACK_ID ? { ...t, clips } : t));
  const end = Math.max(...tracks.flatMap((t) => t.clips.map((c) => c.startTime + c.duration)), 0);
  return {
    project: {
      ...project,
      modifiedAt: Date.now(),
      timeline: { ...project.timeline, tracks, markers, duration: Math.max(end, round(cursor)) },
    },
    conformed,
  };
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}
