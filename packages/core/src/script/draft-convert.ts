/**
 * Draft-to-Fountain conversion. A labeller (rules or a model) only says which
 * source line numbers form which element; {@link renderFountain} then writes
 * every source line itself, so no script word can be invented or lost, and
 * {@link verifyConversion} proves it by comparing word multisets.
 */

import { parseFountain } from "./fountain";
import { CUE_EXTENSION, HEADING_PATTERN, type ClassifiedLine, type DraftLine } from "./loose";

export type LabelElementType = "action" | "dialogue" | "parenthetical" | "transition";

export interface LabelElement {
  readonly type: LabelElementType;
  /** Source line numbers, ascending. */
  readonly lines: readonly number[];
  /** "" unless dialogue/parenthetical. */
  readonly character: string;
  /** Source line number holding the cue, 0 if none. */
  readonly cueLine: number;
}

export interface LabelScene {
  /** 0 when the scene has no heading line. */
  readonly headingLine: number;
  /** Only when headingLine is 0 and the AI invented one, else "". */
  readonly headingText: string;
  readonly elements: readonly LabelElement[];
}

export interface DraftLabels {
  readonly scenes: readonly LabelScene[];
  readonly characters: readonly string[];
}

export interface ConversionCheck {
  readonly ok: boolean;
  readonly problems: readonly string[];
  /** In source, not in result. */
  readonly missingWords: readonly string[];
  /** In result, not in source (AI headings excluded). */
  readonly addedWords: readonly string[];
}

const AI_HEADING_NOTE = " [[added by AI]]";
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const FORCE_ACTION_START = /^(?:[.@>~=#]|\[\[)/;

const hasLetter = (text: string) => /\p{L}/u.test(text);
const hasLowercase = (text: string) => /\p{Ll}/u.test(text);
const words = (text: string): string[] => (text.match(WORD) ?? []).map((w) => w.toLowerCase());

/** The cue name without `@`, a trailing `(V.O.)` extension or `^`. */
function cueCharacter(text: string): string {
  return (text.startsWith("@") ? text.slice(1) : text).replace(CUE_EXTENSION, "").trim();
}

/** Rule-based labels from classified lines; the fallback when no model labels are available. */
export function labelsFromRules(lines: readonly ClassifiedLine[]): DraftLabels {
  const scenes: { headingLine: number; elements: LabelElement[] }[] = [];
  const characters: string[] = [];
  let scene: { headingLine: number; elements: LabelElement[] } | null = null;
  let action: number[] = [];
  let cue: { line: number; character: string } | null = null;
  let dialogue: number[] = [];

  const current = () => {
    if (!scene) {
      scene = { headingLine: 0, elements: [] };
      scenes.push(scene);
    }
    return scene;
  };
  const flushAction = () => {
    if (action.length) current().elements.push({ type: "action", lines: action, character: "", cueLine: 0 });
    action = [];
  };
  const flushDialogue = () => {
    if (cue && dialogue.length) {
      current().elements.push({ type: "dialogue", lines: dialogue, character: cue.character, cueLine: cue.line });
    }
    dialogue = [];
  };

  for (const line of lines) {
    const { guess, n } = line;
    if (guess !== "dialogue" && guess !== "parenthetical") flushDialogue();
    if (guess === "blank") {
      flushAction();
      cue = null;
    } else if (guess === "heading") {
      flushAction();
      cue = null;
      scene = { headingLine: n, elements: [] };
      scenes.push(scene);
    } else if (guess === "character") {
      flushAction();
      const character = cueCharacter(line.text);
      cue = { line: n, character };
      if (!characters.includes(character)) characters.push(character);
    } else if (guess === "parenthetical" && cue) {
      flushDialogue();
      current().elements.push({ type: "parenthetical", lines: [n], character: cue.character, cueLine: cue.line });
    } else if (guess === "dialogue" && cue) {
      dialogue.push(n);
    } else if (guess === "transition") {
      flushAction();
      current().elements.push({ type: "transition", lines: [n], character: "", cueLine: 0 });
    } else {
      action.push(n);
    }
  }
  flushDialogue();
  flushAction();

  return { scenes: scenes.map((s) => ({ headingLine: s.headingLine, headingText: "", elements: s.elements })), characters };
}

/** Prefix that stops a plain action line being read as a heading, cue, transition or other markup. */
function actionLine(text: string): string {
  const misread =
    HEADING_PATTERN.test(text) ||
    (!hasLowercase(text) && hasLetter(text)) ||
    text.endsWith("TO:") ||
    FORCE_ACTION_START.test(text);
  return misread ? `!${text}` : text;
}

/** Source lines that no element, cue or heading covers (non-blank only). */
function unlabelledLines(lines: readonly DraftLine[], labels: DraftLabels): DraftLine[] {
  const covered = new Set<number>();
  for (const scene of labels.scenes) {
    if (scene.headingLine) covered.add(scene.headingLine);
    for (const el of scene.elements) {
      if (el.cueLine) covered.add(el.cueLine);
      for (const n of el.lines) covered.add(n);
    }
  }
  return lines.filter((l) => l.text !== "" && !covered.has(l.n));
}

interface Block {
  readonly at: number;
  readonly text: string;
}

export function renderFountain(lines: readonly DraftLine[], labels: DraftLabels): string {
  const byN = new Map(lines.map((l) => [l.n, l.text]));
  const textOf = (n: number) => byN.get(n) ?? "";
  const blocks: Block[] = [];
  let lastAt = 0;
  const add = (at: number, text: string) => {
    blocks.push({ at, text });
    lastAt = Math.max(lastAt, at);
  };

  for (const scene of labels.scenes) {
    const firstLine = Math.min(...scene.elements.flatMap((el) => [...el.lines, ...(el.cueLine ? [el.cueLine] : [])]));
    if (scene.headingLine) {
      add(scene.headingLine, `.${textOf(scene.headingLine).replace(/^\./, "")}`);
    } else if (scene.headingText.trim()) {
      const at = Number.isFinite(firstLine) ? firstLine - 0.5 : lastAt + 0.1;
      add(at, `.${scene.headingText.trim().toUpperCase()}${AI_HEADING_NOTE}`);
    }

    let i = 0;
    while (i < scene.elements.length) {
      const el = scene.elements[i];
      if (el.type === "dialogue" || el.type === "parenthetical") {
        const group = [el];
        while (
          i + 1 < scene.elements.length &&
          ["dialogue", "parenthetical"].includes(scene.elements[i + 1].type) &&
          scene.elements[i + 1].cueLine === el.cueLine
        ) {
          group.push(scene.elements[++i]);
        }
        const parts = group
          .flatMap((g) => g.lines.filter((n) => n !== el.cueLine).map((n) => ({ n, paren: g.type === "parenthetical" })))
          .sort((a, b) => a.n - b.n);
        const ext = el.cueLine ? (CUE_EXTENSION.exec(textOf(el.cueLine).replace(/^@/, ""))?.[0] ?? "").trim() : "";
        const extension = ext ? (ext.startsWith("(") ? ` ${ext}` : ext) : "";
        const body = parts.map(({ n, paren }) => {
          const text = textOf(n);
          return paren && !/^\(.*\)$/.test(text) ? `(${text})` : text;
        });
        const at = el.cueLine || (parts[0]?.n ?? lastAt + 0.1);
        add(at, [`@${el.character}${extension}`, ...body].join("\n"));
      } else if (el.type === "transition") {
        for (const n of el.lines) add(n, `>${textOf(n).replace(/^>/, "")}`);
      } else {
        add(el.lines[0] ?? lastAt + 0.1, el.lines.map((n) => actionLine(textOf(n))).join("\n"));
      }
      i++;
    }
  }

  let run: DraftLine[] = [];
  const flushRun = () => {
    if (run.length) add(run[0].n, run.map((l) => actionLine(l.text)).join("\n"));
    run = [];
  };
  for (const line of unlabelledLines(lines, labels)) {
    if (run.length && run[run.length - 1].n + 1 !== line.n) flushRun();
    run.push(line);
  }
  flushRun();

  const ordered = blocks.map((b, i) => ({ ...b, i })).sort((a, b) => a.at - b.at || a.i - b.i);
  return ordered.length ? `${ordered.map((b) => b.text).join("\n\n")}\n` : "";
}

function tally(list: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const w of list) counts.set(w, (counts.get(w) ?? 0) + 1);
  return counts;
}

/** Words that occur more often in `a` than in `b`, each repeated by the difference. */
function difference(a: Map<string, number>, b: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [word, count] of a) for (let k = count - (b.get(word) ?? 0); k > 0; k--) out.push(word);
  return out;
}

const isEmptyColdOpen = (scene: LabelScene) =>
  scene.headingLine === 0 && !scene.headingText.trim() && scene.elements.every((el) => el.type === "transition");

/** Parses the rendered Fountain and checks structure counts and that the word multiset matches the source. */
export function verifyConversion(lines: readonly DraftLine[], labels: DraftLabels, fountain: string): ConversionCheck {
  const doc = parseFountain(fountain);
  const problems: string[] = [];

  const expectedScenes = labels.scenes.filter((s) => !isEmptyColdOpen(s)).length;
  if (expectedScenes !== doc.scenes.length) problems.push(`expected ${expectedScenes} scenes, found ${doc.scenes.length}`);

  const cues = new Set<number>();
  for (const scene of labels.scenes) {
    for (const el of scene.elements) if (el.type === "dialogue" || el.type === "parenthetical") cues.add(el.cueLine);
  }
  const parsedDialogue = doc.scenes.reduce((sum, s) => sum + s.elements.filter((el) => el.type === "dialogue").length, 0);
  if (cues.size !== parsedDialogue) problems.push(`expected ${cues.size} dialogue elements, found ${parsedDialogue}`);

  const unlabelled = unlabelledLines(lines, labels).length;
  if (unlabelled) problems.push(`${unlabelled} lines were not labelled`);

  const source = lines.flatMap((l) => words(l.text));
  const result: string[] = [];
  doc.scenes.forEach((scene, idx) => {
    const syntheticColdOpen = idx === 0 && scene.heading === "COLD OPEN" && labels.scenes[0]?.headingLine === 0 && !labels.scenes[0].headingText.trim();
    if (!syntheticColdOpen) result.push(...words(scene.heading));
    for (const el of scene.elements) {
      if (el.type === "dialogue") {
        result.push(...words(el.character), ...words(el.extension ?? ""), ...words(el.parenthetical ?? ""), ...words(el.text));
      } else {
        result.push(...words(el.text));
      }
    }
  });

  const resultCounts = tally(result);
  for (const w of labels.scenes.flatMap((s) => (s.headingLine === 0 ? words(s.headingText) : []))) {
    const left = (resultCounts.get(w) ?? 0) - 1;
    if (left > 0) resultCounts.set(w, left);
    else resultCounts.delete(w);
  }
  const sourceCounts = tally(source);
  const missingWords = difference(sourceCounts, resultCounts);
  const addedWords = difference(resultCounts, sourceCounts);
  return { ok: problems.length === 0 && !missingWords.length && !addedWords.length, problems, missingWords, addedWords };
}
