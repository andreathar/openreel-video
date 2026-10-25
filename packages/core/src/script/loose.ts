/**
 * Cleanup of pasted screenplay drafts (PDF copy, word processor, email) before
 * any element classification: stray page artifacts are dropped and hard-wrapped
 * prose is rejoined, so later passes see one logical line per paragraph.
 */

import { parseFountain } from "./fountain";

export interface DraftLine {
  /** 1-based line number in the normalized output. */
  readonly n: number;
  /** Blank lines are kept as "". */
  readonly text: string;
  /** First line of the pasted source this line comes from (1-based); absent for hand-built lines. */
  readonly sourceLine?: number;
  /** Last source line it covers (a rejoined paragraph or a collapsed blank run spans several). */
  readonly sourceEnd?: number;
}

/** A hard-wrapped word rejoined across a line break (`over-` + `whelmed`), which changes the word list. */
export interface HyphenJoin {
  readonly before: string;
  readonly after: string;
}

export interface NormalizedDraft {
  readonly lines: readonly DraftLine[];
  /**
   * Removed source lines, in input order: page numbers, (MORE)/(CONT'D)/CONTINUED markers,
   * running headers, and " (CONT'D)" cut from a cue. The word check subtracts exactly these.
   */
  readonly dropped: readonly string[];
  readonly joins: readonly HyphenJoin[];
  /** True when nothing was dropped or rejoined, so the text means the same as the source line for line. */
  readonly unchanged: boolean;
}

const PAGE_NUMBER = /^\d{1,3}\.?$/;
/** Standard forms only, case-sensitive: a mixed-case "More" or "Continued" is somebody's line. */
const CONTINUATION = /^\((?:MORE|CONT'D|CONTINUED)\)$|^CONTINUED:?$/;
const TRAILING_CONTD = / \(CONT'D\)$/;
const CUE_SHAPED = /^[\p{Lu}\p{N} '.()\-]+$/u;
const SCENE_PREFIX = /^(INT|EXT|EST|I\/E)\b/i;
const SENTENCE_END = /[.!?:;"')]$/;
const REPEAT_THRESHOLD = 3;
const REPEAT_MAX_WORDS = 6;

const wordCount = (text: string) => (text.match(/\S+/g) ?? []).length;
/** Lowercase letters other than ß, which has no single-letter capital in most text. */
const hasLower = (text: string) => /\p{Ll}/u.test(text.replace(/ß/g, ""));
const isAllCaps = (text: string) => /\p{Lu}/u.test(text) && !hasLower(text);
const startsLower = (text: string) => /^\p{Ll}/u.test(text);
const isPageArtifact = (line: string) => PAGE_NUMBER.test(line) || CONTINUATION.test(line);

/**
 * A repeated line is a running header/footer only when it sits alone between blank lines
 * (or page artifacts) and could not be a cue, transition, dialogue or heading.
 */
function isRunningHeader(line: string, count: number, prev: string | undefined, next: string | undefined): boolean {
  return (
    count >= REPEAT_THRESHOLD &&
    wordCount(line) <= REPEAT_MAX_WORDS &&
    !CUE_SHAPED.test(line) &&
    !line.endsWith(":") &&
    !/[.!?"')]$/.test(line) &&
    !SCENE_PREFIX.test(line) &&
    (prev === undefined || prev === "" || isPageArtifact(prev)) &&
    (next === undefined || next === "")
  );
}

interface Span {
  text: string;
  first: number;
  last: number;
}

export function normalizeDraft(text: string): NormalizedDraft {
  const cleaned = text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .split("\n")
    .map((line) => line.trim());

  const counts = new Map<string, number>();
  for (const line of cleaned) if (line) counts.set(line, (counts.get(line) ?? 0) + 1);

  const dropped: string[] = [];
  const kept: Span[] = [];
  cleaned.forEach((line, i) => {
    const at = i + 1;
    // The line right under a cue is the dialogue slot: never drop it, whatever it looks like.
    const prev = cleaned[i - 1];
    const afterCue = !!prev && CUE_SHAPED.test(prev) && !isPageArtifact(prev);
    if (line && !afterCue && (isPageArtifact(line) || isRunningHeader(line, counts.get(line) ?? 0, prev, cleaned[i + 1]))) {
      dropped.push(line);
      return;
    }
    if (TRAILING_CONTD.test(line)) {
      dropped.push(" (CONT'D)");
      kept.push({ text: line.replace(TRAILING_CONTD, "").trimEnd(), first: at, last: at });
      return;
    }
    kept.push({ text: line, first: at, last: at });
  });

  const joins: HyphenJoin[] = [];
  let spaceJoins = 0;
  const joined: Span[] = [];
  for (const span of kept) {
    const prev = joined[joined.length - 1];
    if (prev && prev.text && span.text && startsLower(span.text)) {
      if (/[^-]-$/.test(prev.text)) {
        const after = prev.text.slice(0, -1) + span.text;
        joins.push({ before: `${prev.text}\n${span.text}`, after });
        joined[joined.length - 1] = { ...prev, text: after, last: span.last };
        continue;
      }
      if (!SENTENCE_END.test(prev.text) && !isAllCaps(prev.text)) {
        spaceJoins++;
        joined[joined.length - 1] = { ...prev, text: `${prev.text} ${span.text}`, last: span.last };
        continue;
      }
    }
    joined.push({ ...span });
  }

  const collapsed: Span[] = [];
  for (const span of joined) {
    const prev = collapsed[collapsed.length - 1];
    if (span.text === "" && collapsed.length === 0) continue;
    if (span.text === "" && prev?.text === "") {
      prev.last = span.last;
      continue;
    }
    collapsed.push(span);
  }
  while (collapsed[collapsed.length - 1]?.text === "") collapsed.pop();

  return {
    lines: collapsed.map((span, i) => ({ n: i + 1, text: span.text, sourceLine: span.first, sourceEnd: span.last })),
    dropped,
    joins,
    unchanged: dropped.length === 0 && joins.length === 0 && spaceJoins === 0,
  };
}

export type LineGuess =
  | "heading"
  | "action"
  | "character"
  | "dialogue"
  | "parenthetical"
  | "transition"
  | "blank";

export interface ClassifiedLine extends DraftLine {
  readonly guess: LineGuess;
  /** 0..1; lines below {@link CONFIDENT} are candidates for AI review. */
  readonly conf: number;
}

/** Minimum confidence at which a rule-based guess is trusted without review. */
export const CONFIDENT = 0.8;

/** Scene heading or numbered scene line in English, Portuguese, Spanish, French or German. */
export const HEADING_PATTERN =
  /^(?:\.(?!\.)|(?:INT\.?\/EXT|INT\/EXT|EXT\.?\/INT|I\/E|INT|EXT|EST|INTERIOR|EXTERIOR|INTERNO|EXTERNO|INTERIOR\/EXTERIOR|INT[ÉE]RIEUR|EXT[ÉE]RIEUR|INNEN|AUSSEN|AUßEN)\b[.\s:-]|(?:SCENE|SCÈNE|ESCENA|CENA|SZENE)\s+\d+\b)/i;

export const CUE_EXTENSION = /\s*\([^)]*\)\s*\^?$|\s*\^$/;
const CUE_MAX_WORDS = 4;
const CUE_MAX_LENGTH = 32;
const CUE_SHORT_WORDS = 2;
const PARENTHETICAL = /^\(.*\)$/;
const FIXED_TRANSITION = /^FADE (?:OUT|TO BLACK)\.$/;

const isUpperCased = (text: string) => /\p{L}/u.test(text) && !hasLower(text);

/** The cue name without `@`, a trailing `(V.O.)` extension or `^`, or null when the shape does not fit. */
function cueName(text: string, next: string | undefined): string | null {
  if (next === undefined || next === "") return null;
  const forced = text.startsWith("@");
  const name = (forced ? text.slice(1) : text).replace(CUE_EXTENSION, "").trim();
  if (!name) return null;
  if (forced) return name.toUpperCase();
  if (wordCount(name) > CUE_MAX_WORDS || name.length > CUE_MAX_LENGTH) return null;
  if (!isUpperCased(name) || /[.!?]$/.test(name)) return null;
  return name;
}

function isTransition(text: string): boolean {
  if (text.startsWith(">")) return !text.endsWith("<");
  return (isUpperCased(text) && text.endsWith("TO:")) || FIXED_TRANSITION.test(text);
}

/** Rule-based element guess and confidence for every line; low-confidence lines are meant for AI review. */
export function classifyLines(lines: readonly DraftLine[]): ClassifiedLine[] {
  const textAt = (i: number): string | undefined => lines[i]?.text;
  const afterBlank = (i: number) => i === 0 || textAt(i - 1) === "";

  const cueCounts = new Map<string, number>();
  lines.forEach((line, i) => {
    if (!line.text || !afterBlank(i)) return;
    const name = cueName(line.text, textAt(i + 1));
    if (name) cueCounts.set(name, (cueCounts.get(name) ?? 0) + 1);
  });

  const out: ClassifiedLine[] = [];
  let inDialogue = false;
  lines.forEach((line, i) => {
    const { text } = line;
    const push = (guess: LineGuess, conf: number) => out.push({ ...line, guess, conf });

    if (text === "") {
      inDialogue = false;
      push("blank", 1);
    } else if (inDialogue) {
      if (PARENTHETICAL.test(text)) push("parenthetical", 0.9);
      else push("dialogue", 0.85);
    } else if (HEADING_PATTERN.test(text)) {
      push("heading", afterBlank(i) ? 0.95 : 0.6);
    } else if (isTransition(text)) {
      push("transition", 0.9);
    } else {
      const name = afterBlank(i) ? cueName(text, textAt(i + 1)) : null;
      if (name) {
        const sure = (cueCounts.get(name) ?? 0) >= 2 || wordCount(name) <= CUE_SHORT_WORDS;
        push("character", sure ? 0.9 : 0.7);
        inDialogue = true;
      } else {
        const sentence = hasLower(text) && /[.!?"]$/.test(text);
        push("action", sentence ? 0.9 : 0.6);
      }
    }
  });
  return out;
}

export type DraftKind = "fountain" | "screenplay" | "prose";

const FOUNTAIN_CONFIDENT_SHARE = 0.8;

export function detectDraftKind(source: string, lines: readonly ClassifiedLine[]): DraftKind {
  const content = lines.filter((l) => l.guess !== "blank");
  const confident = content.filter((l) => l.conf >= CONFIDENT).length;
  const hasScene = parseFountain(source).scenes.some((scene) => scene.heading !== "COLD OPEN");
  if (hasScene && content.length > 0 && confident / content.length >= FOUNTAIN_CONFIDENT_SHARE) return "fountain";
  if (content.some((l) => l.guess === "heading") || content.filter((l) => l.guess === "character").length >= 2) {
    return "screenplay";
  }
  return "prose";
}
