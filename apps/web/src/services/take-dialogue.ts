import {
  SCRIPT_SHOT_MEDIA_PREFIX,
  checkTakeDialogue,
  linkedTake,
  setTakeSpeech,
  type MediaItem,
  type ProductionManifest,
} from "@openreel/core";
import { loadAudioBuffer } from "../utils/load-audio-buffer";
import type { WhisperModelKey } from "../workers/whisper-models";
import { transcribeMulticamChannels } from "./multicam-transcription";

export interface DialogueCheckResult {
  readonly manifest: ProductionManifest;
  readonly checked: string[];
  /** Shots skipped because their take is not loaded in the editor. */
  readonly skipped: string[];
}

/**
 * Transcribes the take linked to each shot with the in-browser Whisper worker
 * and stores the result as the take's `speech`, compared with the scripted
 * dialogue. Shots without dialogue are skipped — nothing to check.
 */
export async function checkShotDialogue(
  manifest: ProductionManifest,
  media: readonly MediaItem[],
  shotIds: readonly string[],
  options: { model?: WhisperModelKey; onStatus?: (message: string) => void } = {},
): Promise<DialogueCheckResult> {
  const items = new Map(media.map((m) => [m.id, m]));
  const buffers = new Map<string, AudioBuffer>();
  const takes = new Map<string, number>();
  const skipped: string[] = [];
  const audioContext = new AudioContext();
  try {
    for (const id of shotIds) {
      const shot = manifest.shots.find((s) => s.id === id);
      const take = shot && linkedTake(shot);
      const item = items.get(SCRIPT_SHOT_MEDIA_PREFIX + id);
      if (!shot?.dialogue?.length || !take || !item || item.isPlaceholder) {
        if (shot?.dialogue?.length) skipped.push(id);
        continue;
      }
      const blob = item.blob ?? (item.fileHandle ? await item.fileHandle.getFile() : null);
      if (!blob) {
        skipped.push(id);
        continue;
      }
      options.onStatus?.(`Extracting audio · ${id}`);
      const buffer = await loadAudioBuffer(audioContext, blob);
      if (!buffer) {
        skipped.push(id);
        continue;
      }
      buffers.set(id, buffer);
      takes.set(id, take.take);
    }
  } finally {
    void audioContext.close();
  }
  if (!buffers.size) return { manifest, checked: [], skipped };

  const transcripts = await transcribeMulticamChannels(buffers, {
    model: options.model ?? "fast",
    onStatus: (id, message) => options.onStatus?.(`${message} · ${id}`),
  });
  let next = manifest;
  const model = options.model === "accurate" ? "whisper-large-v3-turbo" : "whisper-tiny";
  for (const [id, segments] of Object.entries(transcripts)) {
    const shot = next.shots.find((s) => s.id === id)!;
    const speech = checkTakeDialogue(
      shot,
      segments.map((s) => ({ start: s.startMs / 1000, end: s.endMs / 1000, text: s.text })),
      model,
    );
    next = setTakeSpeech(next, id, takes.get(id)!, speech);
  }
  return { manifest: next, checked: [...buffers.keys()], skipped };
}
