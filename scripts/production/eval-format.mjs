#!/usr/bin/env node
// Manual quality check for `format-script`: converts each draft in
// eval-drafts/ with the local model and compares scene headings and
// (character, first 3 words) dialogue keys with <draft>.expected.json.
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

  const sHits = overlap(foundScenes, wantScenes);
  const dHits = overlap(foundDialogue, wantDialogue);
  rows.push({
    file: base,
    kind: result.kind,
    ai: result.usedAI ? "yes" : "no",
    sP: ratio(sHits, foundScenes.length),
    sR: ratio(sHits, wantScenes.length),
    dP: ratio(dHits, foundDialogue.length),
    dR: ratio(dHits, wantDialogue.length),
    ok: result.check.ok ? "yes" : "NO",
    flags: result.flagged.length,
  });
}

const header = ["draft", "kind", "ai", "scene P", "scene R", "dlg P", "dlg R", "check.ok", "flags"];
const widths = [16, 10, 4, 8, 8, 6, 6, 9, 5];
const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join(" ");
console.log(line(header));
for (const r of rows) console.log(line([r.file, r.kind, r.ai, r.sP, r.sR, r.dP, r.dR, r.ok, r.flags]));
