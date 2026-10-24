import {
  SCRIPT_SHOT_MEDIA_PREFIX,
  SCRIPT_SHOTS_TRACK_ID,
  assembleDialogue,
  type AssembleDialogueResult,
  type MediaItem,
  type Project,
  type ScriptShotClipMetadata,
} from "@openreel/core";
import { saveMediaBlob } from "./media-storage";
import { extractAudioTracks } from "./separate-audio";

/** Audio-only media extracted from a shot's take, reused while the take stays linked. */
const DIALOGUE_MEDIA_PREFIX = "script-dialogue-";

function dialogueMediaId(shotId: string, take: MediaItem): string {
  return `${DIALOGUE_MEDIA_PREFIX}${shotId}-${take.sourceFile?.lastModified ?? 0}-${take.metadata.fileSize ?? 0}`;
}

/**
 * Extracts each linked take's sound (once per take file), adds it to the
 * media library and runs the core dialogue assembly with J/L cuts. Returns
 * the new project for the caller to apply as one undoable edit.
 */
export async function assembleSceneDialogue(
  project: Project,
  options: { sceneCode?: string; overlap?: number; onStatus?: (message: string) => void } = {},
): Promise<AssembleDialogueResult & { extracted: number }> {
  const items = new Map(project.mediaLibrary.items.map((m) => [m.id, m]));
  const shotClips = project.timeline.tracks.find((t) => t.id === SCRIPT_SHOTS_TRACK_ID)?.clips ?? [];
  const audio = new Map<string, string>();
  const added: MediaItem[] = [];

  for (const clip of shotClips) {
    const script = clip.metadata?.script as ScriptShotClipMetadata | undefined;
    if (!script || (options.sceneCode && script.sceneCode !== options.sceneCode)) continue;
    const take = items.get(SCRIPT_SHOT_MEDIA_PREFIX + script.shotId);
    if (!take || take.isPlaceholder || take.type !== "video" || take.metadata.hasAudio === false) continue;

    const id = dialogueMediaId(script.shotId, take);
    if (!items.has(id)) {
      options.onStatus?.(`Extracting audio · ${script.shotId}`);
      const [source] = await extractAudioTracks(take);
      const item: MediaItem = { ...source, id, name: `${script.shotId}_dialogue.wav` };
      await saveMediaBlob(project.id, id, item.blob!, item.metadata);
      items.set(id, item);
      added.push(item);
    }
    audio.set(script.shotId, id);
  }

  // Keep extracted sound for shots outside the requested scene on the tracks too.
  if (options.sceneCode) {
    for (const clip of shotClips) {
      const shotId = (clip.metadata?.script as ScriptShotClipMetadata | undefined)?.shotId;
      const existing = project.timeline.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === `dialogue-${shotId}`);
      if (shotId && existing && !audio.has(shotId)) audio.set(shotId, existing.mediaId);
    }
  }

  const withMedia: Project = added.length
    ? { ...project, mediaLibrary: { ...project.mediaLibrary, items: [...project.mediaLibrary.items, ...added] } }
    : project;
  return { ...assembleDialogue(withMedia, audio, { overlap: options.overlap }), extracted: added.length };
}
