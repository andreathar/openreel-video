import type { Project } from "../types/project";
import type { ScriptShotClipMetadata } from "./timeline-builder";
import { SCRIPT_SHOTS_TRACK_ID } from "./timeline-builder";

/**
 * CMX3600 EDL of the script SHOTS track, for finishing in DaVinci Resolve or
 * Premiere. Each event carries `* FROM CLIP NAME:` with the take's file name,
 * which is what both apps use to relink. Timecode is non-drop at the
 * project's frame rate (rounded to a whole number); record time starts at
 * 01:00:00:00 like most finishing timelines.
 */

export interface ScriptEdlOptions {
  /** Only this scene's shots; record time then starts at the scene's first shot. */
  readonly sceneCode?: string;
  /** EDL title; defaults to the project name (and scene). */
  readonly title?: string;
  /** Record start in seconds. Defaults to one hour. */
  readonly recordStart?: number;
}

export interface ScriptEdl {
  readonly text: string;
  readonly events: number;
  /** Shot ids still on a placeholder (exported as black, `BL` reel). */
  readonly placeholders: string[];
}

export function framesToTimecode(frames: number, fps: number): string {
  const f = Math.max(0, Math.round(frames));
  const pad = (n: number) => String(n).padStart(2, "0");
  return [Math.floor(f / (fps * 3600)), Math.floor(f / (fps * 60)) % 60, Math.floor(f / fps) % 60, f % fps].map(pad).join(":");
}

export function buildScriptEdl(project: Project, options: ScriptEdlOptions = {}): ScriptEdl {
  const fps = Math.max(1, Math.round(project.settings.frameRate || 30));
  const track = project.timeline.tracks.find((t) => t.id === SCRIPT_SHOTS_TRACK_ID);
  const media = new Map(project.mediaLibrary.items.map((m) => [m.id, m]));
  const clips = [...(track?.clips ?? [])]
    .filter((c) => !options.sceneCode || (c.metadata?.script as ScriptShotClipMetadata | undefined)?.sceneCode === options.sceneCode)
    .sort((a, b) => a.startTime - b.startTime);

  const frames = (seconds: number) => Math.round(seconds * fps);
  const recordStart = frames(options.recordStart ?? 3600);
  const offset = clips.length ? frames(clips[0].startTime) : 0;
  const title = (options.title ?? (options.sceneCode ? `${project.name} ${options.sceneCode}` : project.name)).replace(/[\r\n]/g, " ");

  const lines = [`TITLE: ${title}`, "FCM: NON-DROP FRAME", ""];
  const placeholders: string[] = [];
  clips.forEach((clip, i) => {
    const script = clip.metadata?.script as ScriptShotClipMetadata | undefined;
    const item = media.get(clip.mediaId);
    const placeholder = !item || item.isPlaceholder;
    const shotId = script?.shotId ?? clip.id;
    if (placeholder) placeholders.push(shotId);

    const length = frames(clip.duration);
    const srcIn = placeholder ? 0 : frames(clip.inPoint);
    const recIn = recordStart + frames(clip.startTime) - offset;
    const num = String(i + 1).padStart(3, "0");
    const reel = placeholder ? "BL" : "AX";
    lines.push(
      `${num}  ${reel.padEnd(8)} V     C        ${framesToTimecode(srcIn, fps)} ${framesToTimecode(srcIn + length, fps)} ${framesToTimecode(recIn, fps)} ${framesToTimecode(recIn + length, fps)}`,
    );
    if (!placeholder) {
      lines.push(`* FROM CLIP NAME: ${item.name}`);
      lines.push(`* SOURCE FILE: ${item.name}`);
    }
    lines.push(`* COMMENT: ${shotId}${script ? ` ${script.heading}` : ""}${placeholder ? " (NO TAKE YET)" : ""}`);
    lines.push("");
  });
  return { text: lines.join("\n"), events: clips.length, placeholders };
}
