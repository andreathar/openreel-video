/**
 * Cleanup of pasted screenplay drafts (PDF copy, word processor, email) before
 * any element classification: stray page artifacts are dropped and hard-wrapped
 * prose is rejoined, so later passes see one logical line per paragraph.
 */

export interface DraftLine {
  /** 1-based line number in the normalized output. */
  readonly n: number;
  /** Blank lines are kept as "". */
  readonly text: string;
}

export interface NormalizedDraft {
  readonly lines: readonly DraftLine[];
  /** Removed artifacts, in input order (page numbers, headers, CONT'D markers). */
  readonly dropped: readonly string[];
}

const PAGE_NUMBER = /^\d{1,3}\.?$/;
const CONTINUATION = /^\(?(CONTINUED|CONT'D|MORE)\)?:?$/i;
const TRAILING_CONTD = / \(CONT'D\)$/;
const CUE_SHAPED = /^[A-Z0-9 '.()-]+$/;
const SCENE_PREFIX = /^(INT|EXT|EST|I\/E)\b/i;
const SENTENCE_END = /[.!?:;"')]$/;
const REPEAT_THRESHOLD = 3;
const REPEAT_MAX_WORDS = 6;

const wordCount = (text: string) => (text.match(/\S+/g) ?? []).length;
const isAllCaps = (text: string) => /[A-Z]/.test(text) && !/[a-z]/.test(text);
const startsLower = (text: string) => /^[a-z]/.test(text);

/** A repeated line is a running header/footer unless it could be a cue, dialogue or heading. */
function isRunningHeader(line: string, count: number): boolean {
  return (
    count >= REPEAT_THRESHOLD &&
    wordCount(line) <= REPEAT_MAX_WORDS &&
    !CUE_SHAPED.test(line) &&
    !/[.!?"')]$/.test(line) &&
    !SCENE_PREFIX.test(line)
  );
}

export function normalizeDraft(text: string): NormalizedDraft {
  const cleaned = text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .split("\n")
    .map((line) => line.trim());

  const counts = new Map<string, number>();
  for (const line of cleaned) if (line) counts.set(line, (counts.get(line) ?? 0) + 1);

  const dropped: string[] = [];
  const kept: string[] = [];
  for (const line of cleaned) {
    if (line && (PAGE_NUMBER.test(line) || CONTINUATION.test(line) || isRunningHeader(line, counts.get(line) ?? 0))) {
      dropped.push(line);
      continue;
    }
    if (TRAILING_CONTD.test(line)) {
      dropped.push(" (CONT'D)");
      kept.push(line.replace(TRAILING_CONTD, "").trimEnd());
      continue;
    }
    kept.push(line);
  }

  const joined: string[] = [];
  for (const line of kept) {
    const prev = joined[joined.length - 1];
    if (prev && line && startsLower(line)) {
      if (/[^-]-$/.test(prev)) {
        joined[joined.length - 1] = prev.slice(0, -1) + line;
        continue;
      }
      if (!SENTENCE_END.test(prev) && !isAllCaps(prev)) {
        joined[joined.length - 1] = `${prev} ${line}`;
        continue;
      }
    }
    joined.push(line);
  }

  const collapsed: string[] = [];
  for (const line of joined) {
    if (line === "" && (collapsed.length === 0 || collapsed[collapsed.length - 1] === "")) continue;
    collapsed.push(line);
  }
  while (collapsed[collapsed.length - 1] === "") collapsed.pop();

  return { lines: collapsed.map((lineText, i) => ({ n: i + 1, text: lineText })), dropped };
}
