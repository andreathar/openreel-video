/**
 * Prompts and parsers for the local vision model (LM Studio / Ollama on the
 * editing machine). Pure functions: the callers own the HTTP and file I/O, so
 * the same code serves the production CLI, the agent and the browser.
 *
 * Small local models drift (invented kinds, prose around JSON, code fences),
 * so every parser tolerates that and clamps values to what the pipeline uses.
 */

import type { EntityKind } from "./naming";
import type { ProductionEntity, ProductionManifest, ProductionShot, TakeReview } from "./production";

export const ENTITY_KINDS: readonly EntityKind[] = ["CHR", "LOC", "PRP", "VOX"];

/** Tags accepted by Kling element_create. */
export const KLING_ELEMENT_TAGS = ["Characters", "Animals", "Items", "Costumes", "Scenes", "Effects", "Others"] as const;
export type KlingElementTag = (typeof KLING_ELEMENT_TAGS)[number];

const KIND_TAG: Record<EntityKind, KlingElementTag> = { CHR: "Characters", LOC: "Scenes", PRP: "Items", VOX: "Others" };

export interface ChatMessage {
  readonly role: "system" | "user";
  readonly text: string;
  /** JPEG/PNG data URIs sent as image_url parts. */
  readonly images?: readonly string[];
}

export interface ReferenceNaming {
  readonly kind: EntityKind;
  /** Short display label, e.g. "Mara" or "Vault". Becomes the slug of the entity code. */
  readonly label: string;
  readonly description: string;
  readonly tags: readonly KlingElementTag[];
  /** Code of an existing entity this image is another view of, if the model matched one. */
  readonly existingCode?: string;
}

/**
 * Asks the model to classify one reference image. Existing entities are listed
 * so a new angle of a known character is filed under the same code.
 */
export function buildReferenceNamingPrompt(
  manifest: Pick<ProductionManifest, "projectCode" | "entities">,
  imageDataUri: string,
  fileName: string,
): ChatMessage[] {
  const known = manifest.entities
    .filter((e) => e.kind !== "VOX")
    .map((e) => `- ${e.code}: ${e.displayName}${e.description ? ` — ${e.description}` : ""}`)
    .join("\n");
  return [
    {
      role: "system",
      text:
        "You file reference images for an AI film production. Answer with one JSON object only, no prose.\n" +
        'Schema: {"kind":"CHR|LOC|PRP","label":"1-3 words","description":"one sentence a video model can use","tags":["Characters|Animals|Items|Costumes|Scenes|Effects|Others"],"existing":"CODE or empty"}\n' +
        "kind: CHR = person, creature or character; LOC = place, set or environment; PRP = object, vehicle, costume piece or prop.\n" +
        "description: visible appearance only (age, build, hair, clothing, colours, materials, lighting) — no story, no guesses about names.",
    },
    {
      role: "user",
      text:
        `Project ${manifest.projectCode}. File name: ${fileName}.\n` +
        (known ? `Known entities (reuse the code if this image shows one of them):\n${known}\n` : "") +
        "Classify this image. /no_think",
      images: [imageDataUri],
    },
  ];
}

export function parseReferenceNaming(
  raw: string,
  manifest: Pick<ProductionManifest, "entities">,
  fileName = "",
): ReferenceNaming {
  const json = extractJsonObject(raw) ?? {};
  const kind = normalizeKind(json.kind, `${json.label ?? ""} ${labelFromFileName(fileName)}`);
  const existingCode = typeof json.existing === "string" ? json.existing.trim().toUpperCase() : "";
  const existing = manifest.entities.find((e) => e.code === existingCode);
  const label = cleanLabel(typeof json.label === "string" ? json.label : "") || existing?.displayName || labelFromFileName(fileName);
  const description = typeof json.description === "string" ? json.description.trim().replace(/\s+/g, " ") : "";
  const tags = normalizeTags(json.tags, existing?.kind ?? kind);
  return {
    kind: existing?.kind ?? kind,
    label: existing?.displayName ?? (label || "Untitled"),
    description,
    tags,
    existingCode: existing?.code,
  };
}

export interface TakeReviewInput {
  readonly shot: Pick<ProductionShot, "id" | "heading" | "description" | "prompt" | "seconds">;
  readonly entities: readonly Pick<ProductionEntity, "code" | "displayName" | "description">[];
  /** Frames sampled evenly from the take, with their timestamps in seconds. */
  readonly frames: readonly { readonly time: number; readonly dataUri: string }[];
  /** One reference image per entity, in the same order as `entities` (optional). */
  readonly entityImages?: readonly string[];
}

/** Asks the model to score a downloaded take against the shot and its references. */
export function buildTakeReviewPrompt(input: TakeReviewInput): ChatMessage[] {
  const { shot, entities, frames } = input;
  const refs = input.entityImages ?? [];
  const cast = entities.map((e, i) => `- ${e.displayName} (${e.code})${refs[i] ? ` = reference image ${i + 1}` : ""}: ${e.description}`).join("\n");
  const times = frames.map((f, i) => `frame ${i + 1} = ${f.time.toFixed(1)}s`).join(", ");
  return [
    {
      role: "system",
      text:
        "You review AI-generated video takes for a film editor. Answer with one JSON object only, no prose.\n" +
        'Schema: {"score":0-10,"issues":["short phrase"],"trimIn":seconds or null,"trimOut":seconds or null}\n' +
        "score 10 = matches the shot and the references perfectly; deduct for wrong identity, wrong place, warped faces or hands, " +
        "text artifacts, frozen or morphing frames, wrong action. trimIn/trimOut: usable range if the start or end is broken.",
    },
    {
      role: "user",
      text:
        `Shot ${shot.id} (${shot.seconds}s) — ${shot.heading}\nAction: ${shot.description}\n` +
        (shot.prompt ? `Prompt used: ${shot.prompt}\n` : "") +
        (cast ? `Cast and places:\n${cast}\n` : "") +
        `${refs.length ? `The first ${refs.length} image(s) are references; the rest are` : "The images are"} frames of the take: ${times}. /no_think`,
      images: [...refs, ...frames.map((f) => f.dataUri)],
    },
  ];
}

export function parseTakeReview(raw: string, model: string, duration: number, now = Date.now()): TakeReview {
  const json = extractJsonObject(raw) ?? {};
  const score = clamp(Math.round(Number(json.score)), 0, 10);
  const issues = Array.isArray(json.issues)
    ? json.issues.filter((i): i is string => typeof i === "string" && i.trim() !== "").map((i) => i.trim()).slice(0, 8)
    : [];
  let trimIn = optionalSeconds(json.trimIn, duration);
  let trimOut = optionalSeconds(json.trimOut, duration);
  if (trimIn !== undefined && trimOut !== undefined && trimOut <= trimIn) trimIn = trimOut = undefined;
  if (trimIn === 0) trimIn = undefined;
  if (trimOut !== undefined && trimOut >= duration) trimOut = undefined;
  return {
    score: Number.isFinite(score) ? score : 0,
    issues: Number.isFinite(Number(json.score)) ? issues : ["review unreadable", ...issues],
    ...(trimIn !== undefined ? { trimIn } : {}),
    ...(trimOut !== undefined ? { trimOut } : {}),
    model,
    reviewedAt: now,
  };
}

/** Converts our messages to the OpenAI-compatible chat format (LM Studio, Ollama /v1). */
export function toOpenAIMessages(messages: readonly ChatMessage[]): unknown[] {
  return messages.map((m) =>
    m.images?.length
      ? {
          role: m.role,
          content: [{ type: "text", text: m.text }, ...m.images.map((url) => ({ type: "image_url", image_url: { url } }))],
        }
      : { role: m.role, content: m.text },
  );
}

/** Finds the first balanced JSON object in model output (handles fences and prose). */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, "");
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === "\\") i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          const value = JSON.parse(text.slice(start, i + 1));
          if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
        } catch {
          // try the next opening brace
        }
        break;
      }
    }
  }
  return null;
}

const KIND_WORDS: [EntityKind, RegExp][] = [
  ["CHR", /\b(chr|char|character|person|people|man|woman|boy|girl|creature|animal|portrait|face|hero|villain)/i],
  ["LOC", /\b(loc|env|environment|location|place|set|scene|room|interior|exterior|landscape|city|street|building|vault|rooftop)/i],
  ["PRP", /\b(prp|prop|item|object|vehicle|car|weapon|costume|tool|device|app)/i],
];

function normalizeKind(value: unknown, hint: string): EntityKind {
  const upper = typeof value === "string" ? value.trim().toUpperCase() : "";
  if ((ENTITY_KINDS as readonly string[]).includes(upper) && upper !== "VOX") return upper as EntityKind;
  for (const [kind, pattern] of KIND_WORDS) if (pattern.test(`${upper} ${hint}`)) return kind;
  return "PRP";
}

function normalizeTags(value: unknown, kind: EntityKind): KlingElementTag[] {
  const tags = Array.isArray(value)
    ? value
        .map((t) => KLING_ELEMENT_TAGS.find((k) => typeof t === "string" && k.toLowerCase() === t.trim().toLowerCase()))
        .filter((t): t is KlingElementTag => t !== undefined)
    : [];
  return tags.length ? [...new Set(tags)] : [KIND_TAG[kind]];
}

function cleanLabel(label: string): string {
  return label
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ");
}

function labelFromFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "";
  return cleanLabel(base.replace(/[_]+/g, " ").replace(/\b(img|image|ref|final|v\d+|copy|\d{3,})\b/gi, " "));
}

function optionalSeconds(value: unknown, duration: number): number | undefined {
  const n = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return undefined;
  return Math.round(clamp(n, 0, duration) * 10) / 10;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
