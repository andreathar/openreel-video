#!/usr/bin/env node
// Production folder CLI: keeps production.json, take file names and downloads
// in sync with Kling / Higgsfield generations. Shares its logic with the
// editor by loading packages/core/src/script directly (Node strips the types).
//
//   node scripts/production/prod.mjs <command> <folder> [args]
//
// Run without arguments for the command list.
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
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

export const MANIFEST_FILE = "production.json";
const MEDIA = /\.(mp4|mov|webm|mkv|png|jpe?g|webp|wav|mp3|m4a)$/i;

const USAGE = `Usage: prod.mjs <command> <folder> [options]

  init <folder> <script.fountain> [--code HSTL] [--target kling-v4-omni]
                                     Build production.json from a screenplay (keeps existing data)
  status <folder> [--scene S001] [--status todo]
                                     Shot table
  targets                            Generators and their reference limits
  entities <folder>                  Entities and which platform ids are missing
  entity <folder> --kind CHR --name MARA [--kling-id ID --kling-type image|video]
         [--hf-id UUID] [--soul-id ID] [--ref path ...] [--description text]
                                     Add/update an entity; prints its canonical name
  payload <folder> <shotId> [--target id]
                                     What to submit: tool, model, prompt, elements, duration,
                                     reference files, file name of the next take, issues
  set <folder> <shotId> [--target id] [--prompt text] [--status s] [--select N]
                                     [--image p ...] [--video p ...] [--audio p ...]
  record <folder> <shotId> --id GENERATION_ID [--target id] [--prompt text] [--ext mp4]
                                     Record a submitted job as the next take; prints its file name
  pending <folder>                   Takes submitted but not downloaded yet
  download <folder> <shotId> <take> <url>
                                     Save a result as shots/<scene>/<take file name> and mark it done
  fail <folder> <shotId> <take>      Mark a take as failed
  scan <folder>                      Register take files already in the folder
`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function print(value) {
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

async function load(folder) {
  const path = join(folder, MANIFEST_FILE);
  if (!existsSync(path)) fail(`No ${MANIFEST_FILE} in ${folder}. Export it from the Shot Board or run init.`);
  return core.parseProductionManifest(await readFile(path, "utf8"));
}

async function save(folder, manifest) {
  const path = join(folder, MANIFEST_FILE);
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, core.serializeProductionManifest(manifest));
  await rename(tmp, path);
}

function shotOf(manifest, shotId) {
  const shot = manifest.shots.find((s) => s.id === shotId);
  if (!shot) fail(`Unknown shot ${shotId}`);
  return shot;
}

function targetOf(id, fallback) {
  const wanted = id ?? fallback;
  if (wanted && !core.GENERATION_TARGETS.some((t) => t.id === wanted)) {
    fail(`Unknown target ${wanted}. Known: ${core.GENERATION_TARGETS.map((t) => t.id).join(", ")}`);
  }
  return core.getGenerationTarget(wanted);
}

async function* walk(dir, depth = 0) {
  if (depth > 5) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, depth + 1);
    else if (MEDIA.test(entry.name)) yield full;
  }
}

function toPosix(path) {
  return path.split(sep).join("/");
}

const commands = {
  async init(folder, [scriptPath], values) {
    if (!scriptPath) fail("init needs a .fountain file");
    const doc = core.parseFountain(await readFile(scriptPath, "utf8"));
    if (doc.scenes.length === 0) fail("No scene headings found");
    const target = targetOf(values.target, core.DEFAULT_GENERATION_TARGET_ID);
    const projectCode = core.normalizeProjectCode(values.code ?? core.deriveProjectCode(doc.title ?? "PROJ"));
    const plan = core.planProduction(doc, { projectCode, profileId: target.profileId ?? core.DEFAULT_SHOT_PROFILE_ID });
    await mkdir(folder, { recursive: true });
    const existing = existsSync(join(folder, MANIFEST_FILE)) ? await load(folder) : undefined;
    const manifest = core.mergeProductionManifest(existing, plan, target.id);
    await save(folder, manifest);
    print(`${manifest.projectCode}: ${plan.scenes.length} scenes, ${manifest.shots.length} shots, ${manifest.entities.length} entities`);
  },

  async status(folder, _rest, values) {
    const manifest = await load(folder);
    const rows = manifest.shots.filter((s) => (!values.scene || s.sceneCode === values.scene) && (!values.status || s.status === values.status));
    for (const shot of rows) {
      const issues = core.validateShotTarget(shot, manifest);
      const takes = shot.takes.map((t) => `T${t.take}${t.status === "done" ? "" : `:${t.status}`}`).join(" ");
      print(`${shot.id}  ${String(shot.seconds).padStart(2)}s  ${shot.status.padEnd(9)} ${shot.targetId.padEnd(20)} ${takes}${issues.length ? `  ⚠ ${issues.join("; ")}` : ""}`);
    }
  },

  async targets() {
    print(core.GENERATION_TARGETS.map(({ id, platform, tool, model, modelTag, limits, note }) => ({ id, platform, tool, model, modelTag, limits, note })));
  },

  async entities(folder) {
    const manifest = await load(folder);
    print(
      manifest.entities.map((e) => ({
        code: e.code,
        kind: e.kind,
        name: e.displayName,
        refs: e.refs,
        kling: e.kling?.elementId ?? null,
        higgsfield: e.higgsfield?.elementId ?? e.higgsfield?.soulId ?? null,
      })),
    );
  },

  async entity(folder, _rest, values) {
    if (!values.kind || !values.name) fail("entity needs --kind and --name");
    if (!["CHR", "LOC", "PRP", "VOX"].includes(values.kind)) fail("--kind must be CHR, LOC, PRP or VOX");
    const manifest = await load(folder);
    const before = manifest.entities.find((e) => e.code === values.code || (e.kind === values.kind && e.displayName === values.name));
    const higgsfield = values["hf-id"] || values["soul-id"]
      ? { ...before?.higgsfield, ...(values["hf-id"] ? { elementId: values["hf-id"] } : {}), ...(values["soul-id"] ? { soulId: values["soul-id"] } : {}) }
      : undefined;
    const next = core.upsertProductionEntity(manifest, {
      kind: values.kind,
      displayName: values.name,
      ...(before ? { code: before.code } : values.code ? { code: values.code } : {}),
      ...(values.description ? { description: values.description } : {}),
      ...(values.ref ? { refs: values.ref } : {}),
      ...(values["kling-id"] ? { kling: { elementId: values["kling-id"], type: values["kling-type"] === "video" ? "video" : "image" } } : {}),
      ...(higgsfield ? { higgsfield } : {}),
    });
    await save(folder, next);
    const saved = next.entities.find((e) => e.code === (before?.code ?? values.code)) ?? next.entities[next.entities.length - 1];
    print(saved);
  },

  async payload(folder, [shotId], values) {
    const manifest = await load(folder);
    const shot = shotOf(manifest, shotId);
    const target = targetOf(values.target, shot.targetId);
    const { prompt, elements } = core.buildShotPrompt(shot, manifest, target);
    const abs = (p) => resolve(folder, p);
    const entityRefs = shot.entities
      .map((code) => manifest.entities.find((e) => e.code === code))
      .filter((e) => e && e.refs.length && !(target.platform === "kling" ? e.kling : e.higgsfield?.elementId))
      .map((e) => ({ entity: e.code, file: abs(e.refs[0]) }));
    print({
      shotId: shot.id,
      heading: shot.heading,
      target: { id: target.id, platform: target.platform, tool: target.tool, model: target.model },
      prompt,
      ...(elements ? { elements } : {}),
      ...(target.output === "video" ? { duration: String(shot.seconds) } : {}),
      references: { images: shot.refs.images.map(abs), videos: shot.refs.videos.map(abs), audios: shot.refs.audios.map(abs), entityImages: entityRefs },
      nextFileName: core.nextTakeFileName(shot, target),
      issues: core.validateShotTarget(shot, manifest, target),
    });
  },

  async set(folder, [shotId], values) {
    const manifest = await load(folder);
    const shot = shotOf(manifest, shotId);
    if (values.status && !core.SHOT_STATUSES.includes(values.status)) fail(`--status must be one of ${core.SHOT_STATUSES.join(", ")}`);
    const patch = {
      ...(values.target ? { targetId: targetOf(values.target).id } : {}),
      ...(values.prompt !== undefined ? { prompt: values.prompt } : {}),
      ...(values.status ? { status: values.status } : {}),
      ...(values.select ? { selectedTake: Number(values.select) } : {}),
      ...(values.image || values.video || values.audio
        ? { refs: { images: values.image ?? shot.refs.images, videos: values.video ?? shot.refs.videos, audios: values.audio ?? shot.refs.audios } }
        : {}),
    };
    const next = core.updateProductionShot(manifest, shotId, patch);
    await save(folder, next);
    const updated = shotOf(next, shotId);
    print({ shot: updated.id, status: updated.status, target: updated.targetId, issues: core.validateShotTarget(updated, next) });
  },

  async record(folder, [shotId], values) {
    if (!values.id) fail("record needs --id <generation id>");
    const manifest = await load(folder);
    shotOf(manifest, shotId);
    const { manifest: next, take } = core.recordProductionTake(manifest, shotId, {
      generationId: values.id,
      ...(values.target ? { targetId: targetOf(values.target).id } : {}),
      ...(values.prompt ? { prompt: values.prompt } : {}),
      ...(values.ext ? { extension: values.ext } : {}),
    });
    await save(folder, next);
    print({ shotId, take: take.take, fileName: take.fileName, generationId: take.generationId });
  },

  async pending(folder) {
    const manifest = await load(folder);
    print(
      manifest.shots.flatMap((shot) =>
        shot.takes
          .filter((t) => t.status === "queued")
          .map((t) => ({ shotId: shot.id, take: t.take, platform: core.getGenerationTarget(t.targetId).platform, generationId: t.generationId ?? null, fileName: t.fileName, submittedAt: new Date(t.submittedAt).toISOString() })),
      ),
    );
  },

  async download(folder, [shotId, takeArg, url]) {
    if (!shotId || !takeArg || !url) fail("download needs <shotId> <take> <url>");
    const manifest = await load(folder);
    const shot = shotOf(manifest, shotId);
    const take = shot.takes.find((t) => t.take === Number(takeArg));
    if (!take) fail(`${shotId} has no take ${takeArg}`);
    const response = await fetch(url);
    if (!response.ok) fail(`Download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const relPath = `shots/${shot.sceneCode}/${take.fileName}`;
    const dest = join(folder, relPath);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
    const { manifest: next } = core.registerTakeFile(manifest, relPath);
    await save(folder, next);
    print({ path: dest, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  },

  async fail(folder, [shotId, takeArg]) {
    const manifest = await load(folder);
    const shot = shotOf(manifest, shotId);
    if (!shot.takes.some((t) => t.take === Number(takeArg))) fail(`${shotId} has no take ${takeArg}`);
    const next = {
      ...manifest,
      shots: manifest.shots.map((s) => (s.id === shotId ? { ...s, takes: s.takes.map((t) => (t.take === Number(takeArg) ? { ...t, status: "failed" } : t)) } : s)),
      updatedAt: Date.now(),
    };
    await save(folder, next);
    print(`${shotId} T${takeArg} marked failed`);
  },

  async scan(folder) {
    let manifest = await load(folder);
    const found = [];
    for await (const file of walk(folder)) {
      const result = core.registerTakeFile(manifest, toPosix(relative(folder, file)));
      manifest = result.manifest;
      if (result.changed) found.push(toPosix(relative(folder, file)));
    }
    if (found.length) await save(folder, manifest);
    print({ registered: found });
  },
};

const [command, ...rest] = process.argv.slice(2);
if (!command || !(command in commands)) {
  console.log(USAGE);
  process.exit(command ? 1 : 0);
}
const { values, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    code: { type: "string" },
    target: { type: "string" },
    scene: { type: "string" },
    status: { type: "string" },
    kind: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    "kling-id": { type: "string" },
    "kling-type": { type: "string" },
    "hf-id": { type: "string" },
    "soul-id": { type: "string" },
    ref: { type: "string", multiple: true },
    prompt: { type: "string" },
    select: { type: "string" },
    image: { type: "string", multiple: true },
    video: { type: "string", multiple: true },
    audio: { type: "string", multiple: true },
    id: { type: "string" },
    ext: { type: "string" },
  },
});
const [folder, ...args] = command === "targets" ? [".", ...positionals] : positionals;
if (!folder) fail("Missing <folder>");
await commands[command](resolve(folder), args, values);
