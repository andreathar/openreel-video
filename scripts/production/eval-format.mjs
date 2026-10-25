#!/usr/bin/env node
// Manual quality check for `format-script`: converts each draft in
// eval-drafts/ with the local model and compares it with <draft>.expected.json.
// Screenplays: exact scene headings and (character, first 3 words) dialogue keys.
// Prose: the model invents the headings, so it is scored by scene count and a
// fuzzy location match (INT/EXT and time of day removed, remaining words compared).
// Not part of CI. Start LM Studio and load the model first; this script never does.
//
//   node scripts/production/eval-format.mjs [--model id]
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && context.parentURL?.endsWith(".ts") && !/\.[cm]?[jt]s$/.test(specifier)) {
      for (const suffix of [".ts", "/index.ts"]) {
        const url = new URL(specifier + suffix, context.parentURL);
        if (existsSync(fileURLToPath(url))) return next(url.href, context);
      }
    }
    return next(specifier, context);
  },
});

const core = await import(new URL("../../packages/core/src/script/index.ts", import.meta.url).href);
const localAi = await import(new URL("./local-ai.mjs", import.meta.url).href);

const { values } = parseArgs({ options: { model: { type: "string" } } });
const dir = fileURLToPath(new URL("./eval-drafts/", import.meta.url));

const request = (p) =>
  localAi.chat(
    [
      { role: "system", content: p.system },
      { role: "user", content: p.user },
    ],
    {
      model: values.model ?? localAi.VLM_MODEL,
      maxTokens: 8000,
      temperature: 0,
      responseFormat: { type: "json_schema", json_schema: { name: p.schemaName, strict: true, schema: p.schema } },
    },
  );

const words = (text) => text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
const dialogueKey = (character, text) => `${character.toUpperCase()}|${words(text).slice(0, 3).join(" ")}`;

/** Multiset intersection size of two key lists. */
function overlap(found, expected) {
  const left = new Map();
  for (const key of expected) left.set(key, (left.get(key) ?? 0) + 1);
  let hits = 0;
  for (const key of found) {
    const count = left.get(key) ?? 0;
    if (count > 0) {
      hits++;
      left.set(key, count - 1);
    }
  }
  return hits;
}

const TIME_OF_DAY = new Set(
  "DAY NIGHT DAWN DUSK MORNING EVENING AFTERNOON SUNRISE SUNSET LATER CONTINUOUS MOMENTS NOITE DIA MADRUGADA TARDE MANHÃ AMANHECER NOCHE MAÑANA".split(" "),
);
const HEADING_PREFIX = /^(?:INT\.?\/EXT|EXT\.?\/INT|I\/E|INT|EXT|EST|INTERIOR|EXTERIOR|INTERNO|EXTERNO)\b\.?\s*/;

/** Location words of a heading: no INT/EXT prefix, no time of day, no possessive 's. */
function locationWords(heading) {
  const rest = heading.toUpperCase().replace(/\s*\[\[.*?\]\]/g, "").trim().replace(HEADING_PREFIX, "");
  return words(rest)
    .map((w) => w.toUpperCase().replace(/'S$/, ""))
    .filter((w) => !TIME_OF_DAY.has(w));
}

/** Greedy one-to-one matches where at least half of the expected location words appear in the found heading. */
function fuzzyLocations(found, expected) {
  const left = expected.map(locationWords);
  let hits = 0;
  for (const heading of found.map(locationWords)) {
    const i = left.findIndex((want) => want && want.length && want.filter((w) => heading.includes(w)).length * 2 >= want.length);
    if (i >= 0) {
      hits++;
      left[i] = null;
    }
  }
  return hits;
}

const ratio = (hits, total) => (total === 0 ? "n/a " : `${((hits / total) * 100).toFixed(0)}%`.padStart(4));

const rows = [];
const names = (await readdir(dir)).filter((f) => f.endsWith(".txt")).sort();
for (const file of names) {
  const base = file.replace(/\.txt$/, "");
  const expected = JSON.parse(await readFile(join(dir, `${base}.expected.json`), "utf8"));
  const result = await core.convertDraft(await readFile(join(dir, file), "utf8"), { request });
  const doc = core.parseFountain(result.fountain);

  const foundScenes = doc.scenes.map((s) => s.heading.replace(/\s*\[\[.*?\]\]/g, "").trim().toUpperCase());
  const wantScenes = expected.scenes.map((s) => s.toUpperCase());
  const foundDialogue = doc.scenes.flatMap((s) => s.elements.filter((e) => e.type === "dialogue").map((e) => dialogueKey(e.character, e.text)));
  const wantDialogue = expected.dialogue.map(([character, text]) => dialogueKey(character, text));

  const prose = result.kind === "prose";
  const sHits = prose ? fuzzyLocations(foundScenes, wantScenes) : overlap(foundScenes, wantScenes);
  const dHits = overlap(foundDialogue, wantDialogue);
  rows.push({
    file: base,
    kind: result.kind,
    ai: result.usedAI ? "yes" : "no",
    scenes: `${foundScenes.length}/${wantScenes.length}`,
    match: prose ? "fuzzy" : "exact",
    sP: ratio(sHits, foundScenes.length),
    sR: ratio(sHits, wantScenes.length),
    dP: ratio(dHits, foundDialogue.length),
    dR: ratio(dHits, wantDialogue.length),
    ok: result.check.ok ? "yes" : "NO",
    dropped: result.dropped.length,
    flags: result.flagged.length,
  });
  if (!result.check.ok) {
    console.error(`${base}: ${[...result.check.problems, ...result.check.missingWords.map((w) => `missing ${w}`), ...result.check.addedWords.map((w) => `added ${w}`)].join("; ")}`);
  }
  for (const f of result.flagged) console.error(`${base}: lines ${f.fromLine}-${f.toLine}: ${f.reason}`);
}

const header = ["draft", "kind", "ai", "scenes", "match", "scene P", "scene R", "dlg P", "dlg R", "check.ok", "dropped", "flags"];
const widths = [16, 10, 4, 7, 6, 8, 8, 6, 6, 9, 8, 5];
const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join(" ");
console.log(line(header));
for (const r of rows) console.log(line([r.file, r.kind, r.ai, r.scenes, r.match, r.sP, r.sR, r.dP, r.dR, r.ok, r.dropped, r.flags]));
