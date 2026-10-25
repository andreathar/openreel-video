import { elementName, normalizeModelTag, parseProductionName, takeFileName, type EntityKind } from "./naming";
import { getShotProfile, type PlannedShot, type ProductionBreakdown } from "./shots";

/**
 * Reference budget of one generation model. `undefined` means the platform
 * does not publish a limit, so it is not checked.
 */
export interface ReferenceLimits {
  /** Reusable subjects (Kling Elements / Higgsfield reference elements). */
  readonly elements?: number;
  /** Elements whose source is a video (Kling video subjects). */
  readonly videoElements?: number;
  readonly images?: number;
  readonly videos?: number;
  readonly audios?: number;
  /** Cap on everything combined, when the platform has one. */
  readonly combined?: number;
  readonly requiresImage?: boolean;
  readonly requiresVideo?: boolean;
}

export type GenerationPlatform = "kling" | "higgsfield";

export interface GenerationTarget {
  readonly id: string;
  readonly label: string;
  readonly platform: GenerationPlatform;
  readonly output: "video" | "image";
  /** MCP/CLI tool that submits the job. */
  readonly tool: string;
  /** Model id passed to that tool. */
  readonly model: string;
  /** Short tag used in take file names. */
  readonly modelTag: string;
  /** Duration profile for video targets. */
  readonly profileId?: string;
  readonly limits: ReferenceLimits;
  readonly supportsSoulId?: boolean;
  readonly note: string;
}

// Limits from Kling who_am_i (mcp 1.3.3) and Higgsfield models_explore, 2026-10-24.
export const GENERATION_TARGETS: readonly GenerationTarget[] = [
  {
    id: "kling-v4-omni",
    label: "Kling 4.0 · Omni-Ref",
    platform: "kling",
    output: "video",
    tool: "omni_ref_video",
    model: "kling-video-v4_0",
    modelTag: "kl-v4",
    profileId: "kling-v4",
    limits: { elements: 7, videoElements: 3, images: 10, videos: 5, audios: 3, combined: 15 },
    note: "Characters as Elements (<<<id>>>), plus reference images, videos and audio. Billed per second, input video included.",
  },
  {
    id: "kling-v4-i2v",
    label: "Kling 4.0 · Image to video",
    platform: "kling",
    output: "video",
    tool: "image_to_video",
    model: "kling-video-v4_0",
    modelTag: "kl-v4i",
    profileId: "kling-v4",
    limits: { elements: 0, images: 10, videos: 0, audios: 0, requiresImage: true },
    note: "First frame, optional last frame and up to 10 keyframes in total. No Elements.",
  },
  {
    id: "kling-o1-image",
    label: "Kling O1 · Image",
    platform: "kling",
    output: "image",
    tool: "image_to_image",
    model: "kling-image-o1",
    modelTag: "kl-o1i",
    limits: { elements: 10, videoElements: 0, images: 10, videos: 0, audios: 0, requiresImage: true },
    note: "Start frames and character sheets. Image Elements only.",
  },
  {
    id: "hf-genjutsu-motion",
    label: "Higgsfield Genjutsu · Motion transfer",
    platform: "higgsfield",
    output: "video",
    tool: "generate_video",
    model: "hf_mult_motion_control",
    modelTag: "hf-gjm",
    profileId: "hf-genjutsu",
    limits: { elements: 0, audios: 0, requiresImage: true, requiresVideo: true },
    note: "Moves the subjects in the reference images like the reference video. Length follows the reference video.",
  },
  {
    id: "hf-genjutsu-replace",
    label: "Higgsfield Genjutsu · Replace object",
    platform: "higgsfield",
    output: "video",
    tool: "generate_video",
    model: "hf_mult_replace_object",
    modelTag: "hf-gjr",
    profileId: "hf-genjutsu",
    limits: { elements: 0, audios: 0, requiresImage: true, requiresVideo: true },
    note: "Replaces objects in the source video with the reference images. Length follows the source video.",
  },
  {
    id: "hf-soul-2",
    label: "Higgsfield Soul 2.0 · Image",
    platform: "higgsfield",
    output: "image",
    tool: "generate_image",
    model: "soul_2",
    modelTag: "hf-soul2",
    limits: { elements: 0, images: 1, videos: 0, audios: 0 },
    supportsSoulId: true,
    note: "Character stills with a Soul ID. One image reference; a Soul style cannot be combined with it.",
  },
];

export const DEFAULT_GENERATION_TARGET_ID = "kling-v4-omni";

export function getGenerationTarget(id: string | undefined): GenerationTarget {
  return GENERATION_TARGETS.find((t) => t.id === id) ?? GENERATION_TARGETS[0];
}

export type ShotStatus = "todo" | "prompted" | "queued" | "generated" | "selected" | "approved";
export const SHOT_STATUSES: readonly ShotStatus[] = ["todo", "prompted", "queued", "generated", "selected", "approved"];

export interface ProductionEntity {
  /** Canonical element name, e.g. HSTL-CHR-MARA. Also the name used on both platforms. */
  readonly code: string;
  readonly kind: EntityKind;
  readonly displayName: string;
  readonly description: string;
  /** Local reference files (project-relative paths). */
  readonly refs: readonly string[];
  /** Kling element tags (Characters, Scenes, Items, ...). */
  readonly tags?: readonly string[];
  readonly kling?: { readonly elementId: string; readonly type: "image" | "video" };
  readonly higgsfield?: { readonly elementId?: string; readonly soulId?: string };
}

export interface ShotReferences {
  readonly images: readonly string[];
  readonly videos: readonly string[];
  readonly audios: readonly string[];
}

export interface ProductionTake {
  readonly take: number;
  readonly targetId: string;
  readonly fileName: string;
  readonly prompt: string;
  readonly submittedAt: number;
  readonly status: "queued" | "done" | "failed";
  /** Kling generationId or Higgsfield job id; the only link back to the platform. */
  readonly generationId?: string;
  readonly mediaId?: string;
  /** Project-folder-relative path of the downloaded file. */
  readonly localPath?: string;
  readonly review?: TakeReview;
  readonly speech?: TakeSpeech;
}

/** A Whisper segment, in seconds from the start of the take file. */
export interface SpeechSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Local Whisper transcript of a take, checked against the shot's script dialogue. */
export interface TakeSpeech {
  readonly segments: readonly SpeechSegment[];
  /** Share (0–1) of the scripted dialogue words heard in the take; 1 when the shot has no dialogue. */
  readonly coverage: number;
  /** Scripted lines that were not heard ("CHARACTER: text"). */
  readonly missing: readonly string[];
  readonly model: string;
  readonly transcribedAt: number;
}

/** Automatic quality check of a downloaded take (local VLM or Claude). */
export interface TakeReview {
  /** 0–10: how well the take matches the shot and its entity references. */
  readonly score: number;
  readonly issues: readonly string[];
  /** Suggested usable range in seconds from the start of the take. */
  readonly trimIn?: number;
  readonly trimOut?: number;
  readonly model: string;
  readonly reviewedAt: number;
}

export interface ProductionShot {
  readonly id: string;
  readonly sceneCode: string;
  readonly heading: string;
  readonly seconds: number;
  readonly description: string;
  /** Scripted dialogue lines, used to check takes' speech. */
  readonly dialogue?: readonly { readonly character: string; readonly text: string }[];
  /** Entity codes appearing in the shot. */
  readonly entities: readonly string[];
  readonly refs: ShotReferences;
  readonly targetId: string;
  readonly prompt: string;
  readonly status: ShotStatus;
  readonly takes: readonly ProductionTake[];
  readonly selectedTake?: number;
  /** Set when a script rebuild removed the shot but it still has takes. */
  readonly orphaned?: boolean;
}

export interface ProductionManifest {
  readonly version: 1;
  readonly projectCode: string;
  readonly title?: string;
  readonly defaultTargetId: string;
  readonly entities: readonly ProductionEntity[];
  readonly shots: readonly ProductionShot[];
  /** Source Fountain text the shots were planned from, when known. */
  readonly script?: string;
  readonly updatedAt: number;
}

const EMPTY_REFS: ShotReferences = { images: [], videos: [], audios: [] };

function entityFor(projectCode: string, kind: EntityKind, label: string): ProductionEntity {
  return { code: elementName(projectCode, kind, label), kind, displayName: label, description: "", refs: [] };
}

function plannedEntities(projectCode: string, shot: PlannedShot, location: string): string[] {
  const codes = shot.characters.map((c) => elementName(projectCode, "CHR", c));
  if (location) codes.push(elementName(projectCode, "LOC", location));
  return codes;
}

/**
 * Creates the production manifest for a script breakdown, or merges a new
 * breakdown into an existing one. Prompts, targets, references, statuses and
 * takes survive; the source `script` is kept unless a
 * new one is passed; shots the script no longer has are dropped unless they
 * already have takes.
 */
export function mergeProductionManifest(
  existing: ProductionManifest | undefined,
  breakdown: ProductionBreakdown,
  defaultTargetId: string = existing?.defaultTargetId ?? DEFAULT_GENERATION_TARGET_ID,
  script?: string,
): ProductionManifest {
  const code = breakdown.projectCode;
  const keptScript = script ?? existing?.script;
  const entities = new Map((existing?.entities ?? []).map((e) => [e.code, e]));
  for (const name of breakdown.characters) {
    const entity = entityFor(code, "CHR", name);
    if (!entities.has(entity.code)) entities.set(entity.code, entity);
  }
  for (const name of breakdown.locations) {
    const entity = entityFor(code, "LOC", name);
    if (!entities.has(entity.code)) entities.set(entity.code, entity);
  }

  const previous = new Map((existing?.shots ?? []).map((s) => [s.id, s]));
  const shots: ProductionShot[] = [];
  for (const scene of breakdown.scenes) {
    for (const planned of scene.shots) {
      const before = previous.get(planned.id);
      previous.delete(planned.id);
      const scripted = plannedEntities(code, planned, scene.location);
      const kept = before ? before.entities.filter((e) => entities.has(e) && !scripted.includes(e)) : [];
      shots.push({
        id: planned.id,
        sceneCode: scene.code,
        heading: scene.heading,
        seconds: planned.seconds,
        description: planned.description,
        ...(planned.dialogue.length ? { dialogue: planned.dialogue } : {}),
        entities: [...scripted, ...kept],
        refs: before?.refs ?? EMPTY_REFS,
        targetId: before?.targetId ?? defaultTargetId,
        prompt: before?.prompt ?? "",
        status: before?.status ?? "todo",
        takes: before?.takes ?? [],
        ...(before?.selectedTake !== undefined ? { selectedTake: before.selectedTake } : {}),
      });
    }
  }
  for (const orphan of previous.values()) {
    if (orphan.takes.length > 0) shots.push({ ...orphan, orphaned: true });
  }

  return {
    version: 1,
    projectCode: code,
    title: breakdown.title ?? existing?.title,
    defaultTargetId,
    entities: [...entities.values()],
    shots,
    ...(keptScript !== undefined ? { script: keptScript } : {}),
    updatedAt: Date.now(),
  };
}

export interface ReferenceCount {
  readonly elements: number;
  readonly videoElements: number;
  readonly images: number;
  readonly videos: number;
  readonly audios: number;
}

function platformElementId(entity: ProductionEntity, target: GenerationTarget): string | undefined {
  if ((target.limits.elements ?? 0) === 0) return undefined;
  return target.platform === "kling" ? entity.kling?.elementId : entity.higgsfield?.elementId;
}

/**
 * Counts what a shot would send to a target. An entity with a platform element
 * counts as an element; one without counts as a single reference image when it
 * has local refs.
 */
export function countShotReferences(
  shot: ProductionShot,
  manifest: ProductionManifest,
  target: GenerationTarget,
): ReferenceCount {
  let elements = 0;
  let videoElements = 0;
  let entityImages = 0;
  for (const code of shot.entities) {
    const entity = manifest.entities.find((e) => e.code === code);
    if (!entity) continue;
    if (platformElementId(entity, target)) {
      elements++;
      if (target.platform === "kling" && entity.kling?.type === "video") videoElements++;
    } else if (entity.refs.length > 0) {
      entityImages++;
    }
  }
  return {
    elements,
    videoElements,
    images: shot.refs.images.length + entityImages,
    videos: shot.refs.videos.length,
    audios: shot.refs.audios.length,
  };
}

/** Lists why a shot does not fit a target; empty when it does. */
export function validateShotTarget(
  shot: ProductionShot,
  manifest: ProductionManifest,
  target: GenerationTarget = getGenerationTarget(shot.targetId),
): string[] {
  const issues: string[] = [];
  const count = countShotReferences(shot, manifest, target);
  const { limits } = target;
  const over = (label: string, used: number, max: number | undefined) => {
    if (max !== undefined && used > max) issues.push(`${used} ${label} (max ${max})`);
  };
  over("elements", count.elements, limits.elements);
  over("video elements", count.videoElements, limits.videoElements);
  over("images", count.images, limits.images);
  over("videos", count.videos, limits.videos);
  over("audio files", count.audios, limits.audios);
  over("references in total", count.elements + count.images + count.videos + count.audios, limits.combined);
  if (limits.requiresImage && count.images + count.elements === 0) issues.push("needs a reference image");
  if (limits.requiresVideo && count.videos === 0) issues.push("needs a reference video");
  if (target.output === "video" && target.profileId) {
    const profile = getShotProfile(target.profileId);
    if (profile.id === target.profileId && (shot.seconds < profile.minSeconds || shot.seconds > profile.maxSeconds)) {
      issues.push(`${shot.seconds}s is outside ${profile.minSeconds}–${profile.maxSeconds}s`);
    }
  }
  return issues;
}

/** Targets the shot fits as it stands. */
export function suggestTargets(shot: ProductionShot, manifest: ProductionManifest): GenerationTarget[] {
  return GENERATION_TARGETS.filter((t) => validateShotTarget(shot, manifest, t).length === 0);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ShotPromptPayload {
  readonly prompt: string;
  /** Kling `elements` argument (JSON string) when the target uses Elements. */
  readonly elements?: string;
}

/**
 * Prompt for a shot on a target: the shot's own prompt (or its script excerpt)
 * with each entity bound to its platform element as <<<id>>>.
 */
export function buildShotPrompt(
  shot: ProductionShot,
  manifest: ProductionManifest,
  target: GenerationTarget = getGenerationTarget(shot.targetId),
): ShotPromptPayload {
  let prompt = shot.prompt.trim() || shot.description;
  const bound: { id: string; bindName: string; type: string }[] = [];
  for (const code of shot.entities) {
    const entity = manifest.entities.find((e) => e.code === code);
    const id = entity && platformElementId(entity, target);
    if (!entity || !id) continue;
    const pattern = new RegExp(`\\b(${escapeRegExp(entity.displayName)}|${escapeRegExp(entity.code)})\\b`, "gi");
    const replaced = prompt.replace(pattern, `<<<${id}>>>`);
    prompt = replaced === prompt ? `${prompt} <<<${id}>>>` : replaced;
    bound.push({ id, bindName: entity.displayName, type: entity.kling?.type ?? "image" });
  }
  return target.platform === "kling" && bound.length > 0
    ? { prompt, elements: JSON.stringify(bound) }
    : { prompt };
}

/** File name of the next take of a shot on a target, e.g. HSTL_S001_SH01_kl-v4_T03.mp4. */
export function nextTakeFileName(shot: ProductionShot, target: GenerationTarget, extension?: string): string {
  const parsed = parseProductionName(shot.id);
  if (!parsed) throw new Error(`Not a production shot id: ${shot.id}`);
  const tag = normalizeModelTag(target.modelTag);
  const take = shot.takes.reduce((max, t) => Math.max(max, t.take), 0) + 1;
  return takeFileName({
    projectCode: parsed.projectCode,
    sceneNumber: parsed.sceneNumber,
    shotNumber: parsed.shotNumber,
    modelTag: tag,
    take,
    extension: extension ?? (target.output === "image" ? "png" : "mp4"),
  });
}

export type ProductionShotPatch = Partial<Pick<ProductionShot, "targetId" | "prompt" | "status" | "refs" | "entities" | "selectedTake">>;

function withShot(
  manifest: ProductionManifest,
  shotId: string,
  update: (shot: ProductionShot) => ProductionShot,
): ProductionManifest {
  if (!manifest.shots.some((s) => s.id === shotId)) throw new Error(`Unknown shot: ${shotId}`);
  return {
    ...manifest,
    shots: manifest.shots.map((s) => (s.id === shotId ? update(s) : s)),
    updatedAt: Date.now(),
  };
}

export function updateProductionShot(
  manifest: ProductionManifest,
  shotId: string,
  patch: ProductionShotPatch,
): ProductionManifest {
  if (patch.targetId !== undefined && !GENERATION_TARGETS.some((t) => t.id === patch.targetId)) {
    throw new Error(`Unknown generation target: ${patch.targetId}`);
  }
  return withShot(manifest, shotId, (shot) => {
    const next = { ...shot, ...patch };
    // A written prompt moves a fresh shot forward.
    if (patch.prompt?.trim() && patch.status === undefined && shot.status === "todo") return { ...next, status: "prompted" };
    return next;
  });
}

export type ProductionEntityPatch = Partial<Pick<ProductionEntity, "displayName" | "description" | "refs" | "tags" | "kling" | "higgsfield">>;

export function upsertProductionEntity(
  manifest: ProductionManifest,
  entity: Pick<ProductionEntity, "kind" | "displayName"> & ProductionEntityPatch & { code?: string },
): ProductionManifest {
  const code = entity.code ?? elementName(manifest.projectCode, entity.kind, entity.displayName);
  const before = manifest.entities.find((e) => e.code === code);
  const merged: ProductionEntity = {
    ...(before ?? { code, kind: entity.kind, displayName: entity.displayName, description: "", refs: [] }),
    ...entity,
    code,
  };
  return {
    ...manifest,
    entities: before ? manifest.entities.map((e) => (e.code === code ? merged : e)) : [...manifest.entities, merged],
    updatedAt: Date.now(),
  };
}

/**
 * Records a submitted generation as the next take of a shot. Platforms do not
 * let us name generations, so the generation id stored here is what ties a
 * download back to its shot.
 */
export function recordProductionTake(
  manifest: ProductionManifest,
  shotId: string,
  take: { targetId?: string; generationId?: string; prompt?: string; extension?: string; status?: ProductionTake["status"] },
): { manifest: ProductionManifest; take: ProductionTake } {
  const shot = manifest.shots.find((s) => s.id === shotId);
  if (!shot) throw new Error(`Unknown shot: ${shotId}`);
  const target = getGenerationTarget(take.targetId ?? shot.targetId);
  const fileName = nextTakeFileName(shot, target, take.extension);
  const record: ProductionTake = {
    take: parseProductionName(fileName)?.take ?? shot.takes.length + 1,
    targetId: target.id,
    fileName,
    prompt: take.prompt ?? buildShotPrompt(shot, manifest, target).prompt,
    submittedAt: Date.now(),
    status: take.status ?? "queued",
    ...(take.generationId ? { generationId: take.generationId } : {}),
  };
  const status: ShotStatus = record.status === "done" ? "generated" : record.status === "queued" ? "queued" : shot.status;
  const next = withShot(manifest, shotId, (s) => ({
    ...s,
    takes: [...s.takes, record],
    status: SHOT_STATUSES.indexOf(s.status) > SHOT_STATUSES.indexOf(status) ? s.status : status,
  }));
  return { manifest: next, take: record };
}

/** Production manifest as a stand-alone document (production.json). */
export function serializeProductionManifest(manifest: ProductionManifest): string {
  return JSON.stringify(manifest, null, 2) + "\n";
}

export function parseProductionManifest(json: string): ProductionManifest {
  const data = JSON.parse(json) as Partial<ProductionManifest>;
  if (data?.version !== 1 || typeof data.projectCode !== "string" || !Array.isArray(data.shots) || !Array.isArray(data.entities)) {
    throw new Error("Not an OpenReel production manifest (version 1)");
  }
  return {
    version: 1,
    projectCode: data.projectCode,
    title: data.title,
    defaultTargetId: getGenerationTarget(data.defaultTargetId).id,
    entities: data.entities,
    shots: data.shots.map((s) => ({ ...s, refs: s.refs ?? EMPTY_REFS, takes: s.takes ?? [], status: SHOT_STATUSES.includes(s.status) ? s.status : "todo" })),
    ...(typeof data.script === "string" ? { script: data.script } : {}),
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
  };
}

const TAKE_RANK: Record<ProductionTake["status"], number> = { queued: 0, failed: 1, done: 2 };

function mergeTakes(a: readonly ProductionTake[], b: readonly ProductionTake[]): ProductionTake[] {
  const byNumber = new Map<number, ProductionTake>();
  for (const take of [...a, ...b]) {
    const seen = byNumber.get(take.take);
    if (!seen) {
      byNumber.set(take.take, take);
      continue;
    }
    const [low, high] = TAKE_RANK[take.status] >= TAKE_RANK[seen.status] ? [seen, take] : [take, seen];
    byNumber.set(take.take, {
      ...low,
      ...high,
      localPath: high.localPath ?? low.localPath,
      generationId: high.generationId ?? low.generationId,
      review: newerReview(high.review, low.review),
      speech: newerSpeech(high.speech, low.speech),
    });
  }
  return [...byNumber.values()].sort((x, y) => x.take - y.take);
}

function newerSpeech(a?: TakeSpeech, b?: TakeSpeech): TakeSpeech | undefined {
  if (!a || !b) return a ?? b;
  return a.transcribedAt >= b.transcribedAt ? a : b;
}

function newerReview(a?: TakeReview, b?: TakeReview): TakeReview | undefined {
  if (!a || !b) return a ?? b;
  return a.reviewedAt >= b.reviewedAt ? a : b;
}

/** Stores a review on a take. */
export function setTakeReview(manifest: ProductionManifest, shotId: string, take: number, review: TakeReview): ProductionManifest {
  const shot = manifest.shots.find((s) => s.id === shotId);
  if (!shot?.takes.some((t) => t.take === take)) throw new Error(`Unknown take ${shotId} T${take}`);
  return withShot(manifest, shotId, (s) => ({ ...s, takes: s.takes.map((t) => (t.take === take ? { ...t, review } : t)) }));
}

export function setTakeSpeech(manifest: ProductionManifest, shotId: string, take: number, speech: TakeSpeech): ProductionManifest {
  const shot = manifest.shots.find((s) => s.id === shotId);
  if (!shot?.takes.some((t) => t.take === take)) throw new Error(`Unknown take ${shotId} T${take}`);
  return withShot(manifest, shotId, (s) => ({ ...s, takes: s.takes.map((t) => (t.take === take ? { ...t, speech } : t)) }));
}

/**
 * Compares a take's transcript with the shot's scripted lines. A line counts
 * as heard when at least 60 % of its words occur in the transcript — AI
 * voices often paraphrase, so exact matching would flag everything.
 */
export function checkTakeDialogue(
  shot: Pick<ProductionShot, "dialogue">,
  segments: readonly SpeechSegment[],
  model: string,
): TakeSpeech {
  const heard = new Set(words(segments.map((s) => s.text).join(" ")));
  let total = 0;
  let matched = 0;
  const missing: string[] = [];
  for (const line of shot.dialogue ?? []) {
    const lineWords = words(line.text);
    if (!lineWords.length) continue;
    const hits = lineWords.filter((w) => heard.has(w)).length;
    total += lineWords.length;
    matched += hits;
    if (hits / lineWords.length < 0.6) missing.push(`${line.character}: ${line.text}`);
  }
  return {
    segments: segments.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() })).filter((s) => s.text),
    coverage: total ? Math.round((matched / total) * 100) / 100 : 1,
    missing,
    model,
    transcribedAt: Date.now(),
  };
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^\p{L}\p{N}']+/u)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

/**
 * Merges two copies of a manifest, e.g. the project's and production.json
 * written by Claude Code. The newer copy wins field by field; takes and
 * platform element ids from both are kept.
 */
export function reconcileProductionManifests(local: ProductionManifest, remote: ProductionManifest): ProductionManifest {
  const [base, other] = remote.updatedAt > local.updatedAt ? [remote, local] : [local, remote];
  const otherShots = new Map(other.shots.map((s) => [s.id, s]));
  const shots: ProductionShot[] = base.shots.map((shot) => {
    const twin = otherShots.get(shot.id);
    otherShots.delete(shot.id);
    return twin ? { ...shot, takes: mergeTakes(twin.takes, shot.takes) } : shot;
  });
  shots.push(...otherShots.values());
  const otherEntities = new Map(other.entities.map((e) => [e.code, e]));
  const entities: ProductionEntity[] = base.entities.map((entity) => {
    const twin = otherEntities.get(entity.code);
    otherEntities.delete(entity.code);
    return twin
      ? { ...entity, kling: entity.kling ?? twin.kling, higgsfield: entity.higgsfield ?? twin.higgsfield, refs: entity.refs.length ? entity.refs : twin.refs }
      : entity;
  });
  entities.push(...otherEntities.values());
  const script = base.script ?? other.script;
  return { ...base, ...(script !== undefined ? { script } : {}), shots: shots.map(promoteShotStatus), entities, updatedAt: Math.max(local.updatedAt, remote.updatedAt) };
}

/** A shot with a downloaded take is at least "generated". */
function promoteShotStatus(shot: ProductionShot): ProductionShot {
  const hasFile = shot.takes.some((t) => t.status === "done" && t.localPath);
  return hasFile && SHOT_STATUSES.indexOf(shot.status) < SHOT_STATUSES.indexOf("generated") ? { ...shot, status: "generated" } : shot;
}

/**
 * Registers a take file found on disk (e.g. shots/S001/HSTL_S001_SH01_kl-v4_T02.mp4).
 * Files are matched purely by their canonical name; anything else is ignored.
 */
export function registerTakeFile(
  manifest: ProductionManifest,
  path: string,
): { manifest: ProductionManifest; shotId?: string; changed: boolean } {
  const parsed = parseProductionName(path);
  if (!parsed?.take || !parsed.modelTag) return { manifest, changed: false };
  const shot = manifest.shots.find((s) => s.id === parsed.shotId);
  if (!shot) return { manifest, changed: false };
  const fileName = path.split(/[\\/]/).pop() ?? path;
  const existing = shot.takes.find((t) => t.take === parsed.take);
  if (existing?.status === "done" && existing.localPath === path) return { manifest, shotId: shot.id, changed: false };
  const target =
    GENERATION_TARGETS.find((t) => normalizeModelTag(t.modelTag) === parsed.modelTag) ?? getGenerationTarget(shot.targetId);
  const take: ProductionTake = existing
    ? { ...existing, fileName, status: "done", localPath: path }
    : { take: parsed.take, targetId: target.id, fileName, prompt: "", submittedAt: Date.now(), status: "done", localPath: path };
  const next = withShot(manifest, shot.id, (s) =>
    promoteShotStatus({ ...s, takes: mergeTakes(s.takes.filter((t) => t.take !== take.take), [take]) }),
  );
  return { manifest: next, shotId: shot.id, changed: true };
}

/** The take a shot's timeline clip should play: the selected one, else the newest downloaded one. */
export function linkedTake(shot: ProductionShot): ProductionTake | undefined {
  const files = shot.takes.filter((t) => t.status === "done" && t.localPath);
  return files.find((t) => t.take === shot.selectedTake) ?? files[files.length - 1];
}
