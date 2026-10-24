/**
 * Minimal Fountain (https://fountain.io) reader focused on what production
 * planning needs: scenes, action, dialogue and transitions. Formatting marks
 * (emphasis, page breaks, sections, synopses) are dropped.
 */

export type ScriptElement =
  | { readonly type: "action"; readonly text: string }
  | {
      readonly type: "dialogue";
      readonly character: string;
      readonly extension?: string;
      readonly parenthetical?: string;
      readonly text: string;
    }
  | { readonly type: "transition"; readonly text: string };

export interface ScriptScene {
  /** 1-based order in the script. */
  readonly index: number;
  /** Explicit `#12A#` scene number when present, otherwise the index. */
  readonly number: string;
  readonly heading: string;
  readonly intExt: string;
  readonly location: string;
  readonly timeOfDay: string;
  readonly elements: readonly ScriptElement[];
  readonly characters: readonly string[];
}

export interface ScriptDocument {
  readonly title?: string;
  readonly titlePage: Readonly<Record<string, string>>;
  readonly scenes: readonly ScriptScene[];
  /** Speaking characters, most lines first. */
  readonly characters: readonly string[];
  readonly locations: readonly string[];
}

const SCENE_HEADING = /^(?:INT\.?\/EXT|INT\/EXT|EXT\.?\/INT|I\/E|INT|EXT|EST)[.\s]/i;
const SCENE_NUMBER = /\s*#([\w.-]+)#\s*$/;
const TRANSITION = /^[A-Z0-9 .'-]+TO:$/;
const FADE_IN = /^>?\s*FADE IN:?\s*$/i;
const TITLE_KEY = /^([A-Za-z][A-Za-z ]*):\s*(.*)$/;

function stripMarkup(source: string): string {
  return source
    .replace(/\r\n?/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\[\[[\s\S]*?\]\]/g, "");
}

function cleanInline(text: string): string {
  return text.replace(/\\\*/g, "\u0000").replace(/[*_]/g, "").replace(/\u0000/g, "*").trim();
}

function isCharacterCue(line: string, next: string | undefined): boolean {
  if (line.startsWith("@")) return true;
  if (!next || next.trim() === "") return false;
  const name = line.replace(/\^$/, "").replace(/\(.*\)\s*$/, "").trim();
  return /[A-Z]/.test(name) && name === name.toUpperCase() && !/^[!>.~=#]/.test(line);
}

function parseTitlePage(lines: string[]): { titlePage: Record<string, string>; bodyStart: number } {
  const titlePage: Record<string, string> = {};
  if (!TITLE_KEY.test(lines[0] ?? "")) return { titlePage, bodyStart: 0 };
  let key = "";
  let i = 0;
  for (; i < lines.length && lines[i].trim() !== ""; i++) {
    const match = TITLE_KEY.exec(lines[i]);
    if (match && !/^\s/.test(lines[i])) {
      key = match[1].trim().toLowerCase();
      titlePage[key] = match[2].trim();
    } else if (key) {
      titlePage[key] = [titlePage[key], lines[i].trim()].filter(Boolean).join("\n");
    }
  }
  return { titlePage, bodyStart: i };
}

function splitHeading(heading: string): Pick<ScriptScene, "intExt" | "location" | "timeOfDay"> {
  const prefix = /^(INT\.?\/EXT\.?|INT\/EXT|EXT\.?\/INT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)\s*/i.exec(heading);
  const intExt = prefix ? prefix[1].replace(/\.$/, "").toUpperCase() : "";
  const rest = prefix ? heading.slice(prefix[0].length) : heading;
  const dash = rest.search(/\s+[-–—]\s+(?=[^-–—]*$)/);
  if (dash < 0) return { intExt, location: rest.trim(), timeOfDay: "" };
  return {
    intExt,
    location: rest.slice(0, dash).trim(),
    timeOfDay: rest.slice(dash).replace(/^\s*[-–—]\s*/, "").trim(),
  };
}

export function parseFountain(source: string): ScriptDocument {
  const lines = stripMarkup(source).split("\n");
  const { titlePage, bodyStart } = parseTitlePage(lines);

  type Draft = { heading: string; number?: string; elements: ScriptElement[] };
  const drafts: Draft[] = [];
  let current: Draft | null = null;
  const ensureScene = (): Draft => {
    if (!current) {
      current = { heading: "COLD OPEN", elements: [] };
      drafts.push(current);
    }
    return current;
  };

  let i = bodyStart;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    const prevBlank = i === 0 || lines[i - 1].trim() === "";
    const next = lines[i + 1];

    if (line === "" || /^={3,}$/.test(line) || line.startsWith("#") || line.startsWith("=") || FADE_IN.test(line)) {
      i++;
      continue;
    }

    const forcedHeading = line.startsWith(".") && !line.startsWith("..");
    if (prevBlank && (forcedHeading || SCENE_HEADING.test(line))) {
      const numberMatch = SCENE_NUMBER.exec(line);
      const heading = cleanInline((forcedHeading ? line.slice(1) : line).replace(SCENE_NUMBER, "")).toUpperCase();
      current = { heading, number: numberMatch?.[1], elements: [] };
      drafts.push(current);
      i++;
      continue;
    }

    const isCentered = line.startsWith(">") && line.endsWith("<");
    if (!isCentered && prevBlank && (line.startsWith(">") || (TRANSITION.test(line) && (next ?? "").trim() === ""))) {
      ensureScene().elements.push({ type: "transition", text: cleanInline(line.replace(/^>/, "")) });
      i++;
      continue;
    }

    if (prevBlank && !line.startsWith("!") && isCharacterCue(line, next)) {
      const cue = line.replace(/^@/, "").replace(/\^$/, "").trim();
      const ext = /\(([^)]*)\)\s*$/.exec(cue);
      // Forced "@" cues keep their case (e.g. @McCLANE).
      const name = cleanInline(cue.replace(/\(([^)]*)\)\s*$/, ""));
      const character = line.startsWith("@") ? name : name.toUpperCase();
      const parentheticals: string[] = [];
      const speech: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "") {
        const part = lines[i].trim();
        if (/^\(.*\)$/.test(part)) parentheticals.push(part.slice(1, -1).trim());
        else speech.push(cleanInline(part));
        i++;
      }
      ensureScene().elements.push({
        type: "dialogue",
        character,
        ...(ext ? { extension: ext[1].trim().toUpperCase() } : {}),
        ...(parentheticals.length ? { parenthetical: parentheticals.join("; ") } : {}),
        text: speech.join(" "),
      });
      continue;
    }

    const action: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      const part = lines[i].trim();
      action.push(cleanInline(part.replace(/^!/, "").replace(/^>(.*)<$/, "$1")));
      i++;
    }
    if (action.length) ensureScene().elements.push({ type: "action", text: action.join("\n") });
  }

  const lineCounts = new Map<string, number>();
  const locations: string[] = [];
  // A cold open holding only transitions is not a scene.
  const kept = drafts.filter((d) => d.number !== undefined || d.heading !== "COLD OPEN" || d.elements.some((el) => el.type !== "transition"));
  const scenes: ScriptScene[] = kept.map((draft, idx) => {
    const characters: string[] = [];
    for (const el of draft.elements) {
      if (el.type !== "dialogue") continue;
      lineCounts.set(el.character, (lineCounts.get(el.character) ?? 0) + 1);
      if (!characters.includes(el.character)) characters.push(el.character);
    }
    const parts = splitHeading(draft.heading);
    if (parts.location && !locations.includes(parts.location)) locations.push(parts.location);
    return {
      index: idx + 1,
      number: draft.number ?? String(idx + 1),
      heading: draft.heading,
      ...parts,
      elements: draft.elements,
      characters,
    };
  });

  const characters = [...lineCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);

  return {
    ...(titlePage.title ? { title: cleanInline(titlePage.title.replace(/\n/g, " ")) } : {}),
    titlePage,
    scenes,
    characters,
    locations,
  };
}
