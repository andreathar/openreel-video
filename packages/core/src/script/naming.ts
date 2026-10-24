/**
 * Canonical production names shared by the timeline, the local shots folder
 * and the generation platforms (Kling, Higgsfield).
 *
 *   element  HSTL-CHR-MARA                 (Higgsfield element names max 32 chars)
 *   scene    S012
 *   shot     HSTL_S012_SH03
 *   take     HSTL_S012_SH03_kl-v3o_T02.mp4
 *
 * Neither platform lets a generation carry a name, so takes are renamed on
 * download and matched back to their shot with `parseProductionName`.
 */

export type EntityKind = "CHR" | "LOC" | "PRP" | "VOX";

export const ELEMENT_NAME_MAX_LENGTH = 32;

const pad = (value: number, width: number) => String(Math.max(0, Math.floor(value))).padStart(width, "0");

function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Derives a 2–6 character project code, e.g. "The Hostile Land" -> "THL". */
export function deriveProjectCode(title: string): string {
  const words = slug(title).split("-").filter(Boolean);
  if (words.length === 0) return "PROJ";
  const code = words.length === 1 ? words[0].slice(0, 4) : words.map((w) => w[0]).join("").slice(0, 6);
  return code.length >= 2 ? code : (code + words[0].slice(1)).slice(0, 4).padEnd(2, "X");
}

export function normalizeProjectCode(code: string): string {
  const cleaned = slug(code).replace(/-/g, "").slice(0, 6);
  return cleaned.length >= 2 ? cleaned : "PROJ";
}

export function sceneCode(sceneNumber: number): string {
  return `S${pad(sceneNumber, 3)}`;
}

export function shotId(projectCode: string, sceneNumber: number, shotNumber: number): string {
  return `${normalizeProjectCode(projectCode)}_${sceneCode(sceneNumber)}_SH${pad(shotNumber, 2)}`;
}

/** Model tag used inside take names: lowercase letters, digits and dashes. */
export function normalizeModelTag(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "gen";
}

export function takeFileName(options: {
  projectCode: string;
  sceneNumber: number;
  shotNumber: number;
  modelTag: string;
  take: number;
  extension?: string;
}): string {
  const ext = (options.extension ?? "mp4").replace(/^\./, "").toLowerCase();
  return `${shotId(options.projectCode, options.sceneNumber, options.shotNumber)}_${normalizeModelTag(options.modelTag)}_T${pad(options.take, 2)}.${ext}`;
}

export function elementName(projectCode: string, kind: EntityKind, label: string): string {
  const prefix = `${normalizeProjectCode(projectCode)}-${kind}-`;
  const body = slug(label) || "UNNAMED";
  return (prefix + body).slice(0, ELEMENT_NAME_MAX_LENGTH).replace(/-+$/, "");
}

export interface ParsedProductionName {
  readonly projectCode: string;
  readonly sceneNumber: number;
  readonly shotNumber: number;
  readonly shotId: string;
  readonly modelTag?: string;
  readonly take?: number;
  readonly extension?: string;
}

const PRODUCTION_NAME = /^([A-Z0-9]{2,6})_S(\d{3})_SH(\d{2})(?:_([a-z0-9-]+)_T(\d{2}))?(?:\.([A-Za-z0-9]+))?$/;

/** Parses a shot id or take file name; returns null for anything else. */
export function parseProductionName(name: string): ParsedProductionName | null {
  const base = name.split(/[\\/]/).pop() ?? name;
  const match = PRODUCTION_NAME.exec(base);
  if (!match) return null;
  const [, projectCode, scene, shot, modelTag, take, extension] = match;
  return {
    projectCode,
    sceneNumber: Number(scene),
    shotNumber: Number(shot),
    shotId: `${projectCode}_S${scene}_SH${shot}`,
    ...(modelTag ? { modelTag, take: Number(take) } : {}),
    ...(extension ? { extension: extension.toLowerCase() } : {}),
  };
}
