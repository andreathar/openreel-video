import type { ScriptElement, ScriptScene } from "./fountain";

/**
 * Screen-time estimates using the industry rule of thumb (one formatted page
 * is about one minute, measured in eighths of a page), with a floor so a
 * dialogue-heavy scene is never shorter than its spoken lines.
 */

const LINES_PER_PAGE = 55;
const ACTION_CHARS_PER_LINE = 61;
const DIALOGUE_CHARS_PER_LINE = 35;
const PARENTHETICAL_CHARS_PER_LINE = 25;
export const DIALOGUE_WORDS_PER_MINUTE = 140;
export const MIN_SCENE_SECONDS = 3;

const wrappedLines = (text: string, width: number) =>
  text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / width)), 0);

const wordCount = (text: string) => (text.match(/\S+/g) ?? []).length;

/** Formatted line count of one element including its trailing blank line. */
export function elementLines(element: ScriptElement): number {
  switch (element.type) {
    case "action":
      return wrappedLines(element.text, ACTION_CHARS_PER_LINE) + 1;
    case "transition":
      return 2;
    case "dialogue":
      return (
        1 +
        (element.parenthetical ? wrappedLines(element.parenthetical, PARENTHETICAL_CHARS_PER_LINE) : 0) +
        wrappedLines(element.text, DIALOGUE_CHARS_PER_LINE) +
        1
      );
  }
}

/** Seconds of speech for one element (0 for non-dialogue). */
export function elementSpeechSeconds(element: ScriptElement): number {
  return element.type === "dialogue" ? (wordCount(element.text) / DIALOGUE_WORDS_PER_MINUTE) * 60 : 0;
}

export interface SceneEstimate {
  readonly eighths: number;
  /** e.g. "1 3/8" */
  readonly pageLength: string;
  readonly dialogueSeconds: number;
  readonly seconds: number;
}

export function formatEighths(eighths: number): string {
  const pages = Math.floor(eighths / 8);
  const rest = eighths % 8;
  if (!rest) return String(pages);
  return pages ? `${pages} ${rest}/8` : `${rest}/8`;
}

export function estimateScene(scene: Pick<ScriptScene, "elements">): SceneEstimate {
  const lines = 2 + scene.elements.reduce((sum, el) => sum + elementLines(el), 0);
  const eighths = Math.max(1, Math.round((lines / LINES_PER_PAGE) * 8));
  const dialogueSeconds = scene.elements.reduce((sum, el) => sum + elementSpeechSeconds(el), 0);
  const pageSeconds = (eighths / 8) * 60;
  const seconds = Math.max(MIN_SCENE_SECONDS, Math.round(Math.max(pageSeconds, dialogueSeconds + 1) * 2) / 2);
  return { eighths, pageLength: formatEighths(eighths), dialogueSeconds, seconds };
}
