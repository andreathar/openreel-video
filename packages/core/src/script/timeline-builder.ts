import type { MediaItem, Project } from "../types/project";
import type { Clip, Marker, Track } from "../types/timeline";
import type { PlannedScene, PlannedShot, ProductionBreakdown } from "./shots";
import { mergeProductionManifest, type ProductionManifest, type ShotStatus } from "./production";

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
