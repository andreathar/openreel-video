import type { ScriptDocument } from "./fountain";

export interface ScriptSummary {
  readonly scenes: number;
  readonly characters: number;
  readonly dialogueLines: number;
}

/** Counts scenes, distinct speaking characters and dialogue elements. */
export function summarizeScript(doc: ScriptDocument): ScriptSummary {
  const names = new Set<string>();
  let dialogueLines = 0;
  for (const scene of doc.scenes) {
    for (const el of scene.elements) {
      if (el.type !== "dialogue") continue;
      dialogueLines++;
      names.add(el.character.trim().toLowerCase());
    }
  }
  return { scenes: doc.scenes.length, characters: names.size, dialogueLines };
}

function plural(n: number, one: string): string {
  return `${n} ${n === 1 ? one : `${one}s`}`;
}

export function formatScriptSummary(s: ScriptSummary): string {
  return [plural(s.scenes, "scene"), plural(s.characters, "character"), plural(s.dialogueLines, "dialogue line")].join(" · ");
}
