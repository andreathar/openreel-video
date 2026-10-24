import {
  SCRIPT_SHOT_MEDIA_PREFIX,
  applyProductionManifest,
  linkedTake,
  parseProductionManifest,
  parseProductionName,
  reconcileProductionManifests,
  registerTakeFile,
  serializeProductionManifest,
  type ProductionManifest,
} from "@openreel/core";
import { editSnapshot } from "@openreel/core/actions/handlers/edit-snapshot";
import { useProjectStore } from "../stores/project-store";
import { cloneEditSnapshot } from "./agent/editing-session";
import { loadDirectoryHandle, saveDirectoryHandle, saveFileHandle } from "./media-storage";

/**
 * Production folder: the directory shared with Claude Code / the prod.mjs CLI.
 *
 *   production.json            manifest (shots, entities, takes)
 *   shots/S001/HSTL_S001_SH01_kl-v4_T01.mp4
 *
 * The editor and the CLI both read and write production.json; sync merges the
 * two copies and links each shot's chosen take to its SHOTS clip.
 */

export const PRODUCTION_FILE = "production.json";
const MEDIA = /\.(mp4|mov|webm|mkv|png|jpe?g|webp|wav|mp3|m4a)$/i;
const MAX_DEPTH = 5;

type PermissionedHandle = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

function folderKey(projectId: string): string {
  return `${projectId}:production`;
}

export function isProductionFolderSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickProductionFolder(projectId: string): Promise<FileSystemDirectoryHandle | null> {
  const picker = (window as unknown as { showDirectoryPicker: (o: { mode: "readwrite"; id?: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await picker({ mode: "readwrite", id: "openreel-production" });
  } catch {
    return null; // cancelled
  }
  await saveDirectoryHandle(folderKey(projectId), handle);
  return handle;
}

/**
 * The folder remembered for a project. With `request` (needs a user gesture)
 * the browser is asked for access again after a reload.
 */
export async function getProductionFolder(projectId: string, request = false): Promise<FileSystemDirectoryHandle | null> {
  const saved = await loadDirectoryHandle(folderKey(projectId)).catch(() => null);
  if (!saved) return null;
  const handle = saved.handle as PermissionedHandle;
  let state = await handle.queryPermission({ mode: "readwrite" });
  if (state !== "granted" && request) state = await handle.requestPermission({ mode: "readwrite" });
  return state === "granted" ? handle : null;
}

export async function rememberedProductionFolderName(projectId: string): Promise<string | null> {
  const saved = await loadDirectoryHandle(folderKey(projectId)).catch(() => null);
  return saved?.folderName ?? null;
}

async function readManifestFile(dir: FileSystemDirectoryHandle): Promise<ProductionManifest | null> {
  try {
    const file = await (await dir.getFileHandle(PRODUCTION_FILE)).getFile();
    return parseProductionManifest(await file.text());
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return null;
    throw error;
  }
}

export async function writeManifestFile(dir: FileSystemDirectoryHandle, manifest: ProductionManifest): Promise<void> {
  const handle = await dir.getFileHandle(PRODUCTION_FILE, { create: true });
  const writable = await handle.createWritable();
  await writable.write(serializeProductionManifest(manifest));
  await writable.close();
}

async function collectTakeFiles(
  dir: FileSystemDirectoryHandle,
  prefix = "",
  depth = 0,
  found = new Map<string, FileSystemFileHandle>(),
): Promise<Map<string, FileSystemFileHandle>> {
  if (depth > MAX_DEPTH) return found;
  for await (const [name, entry] of (dir as PermissionedHandle).entries()) {
    if (name.startsWith(".") || name === "node_modules") continue;
    if (entry.kind === "directory") {
      await collectTakeFiles(entry as FileSystemDirectoryHandle, `${prefix}${name}/`, depth + 1, found);
    } else if (MEDIA.test(name) && parseProductionName(name)?.take) {
      found.set(`${prefix}${name}`, entry as FileSystemFileHandle);
    }
  }
  return found;
}

async function commitManifest(production: ProductionManifest): Promise<void> {
  const store = useProjectStore.getState();
  const next = applyProductionManifest(store.getFullProject(), production);
  const result = await store.executeAction({
    type: "project/applyEditSnapshot",
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    params: { snapshot: cloneEditSnapshot(editSnapshot(next)) },
  });
  if (!result.success) throw new Error(result.error?.message ?? "Could not update the production");
}

function sameManifest(a: ProductionManifest | null | undefined, b: ProductionManifest): boolean {
  return !!a && JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 });
}

export interface ProductionSyncResult {
  readonly registered: readonly string[];
  readonly linked: readonly string[];
  readonly failed: readonly string[];
  readonly manifest: ProductionManifest;
}

/**
 * Merges production.json with the project, registers take files found in the
 * folder, links each shot's chosen take to its clip, then writes the merged
 * manifest back so Claude Code sees the editor's changes.
 */
export async function syncProductionFolder(dir: FileSystemDirectoryHandle): Promise<ProductionSyncResult> {
  const local = useProjectStore.getState().project.production;
  const remote = await readManifestFile(dir);
  let manifest = local && remote ? reconcileProductionManifests(local, remote) : (remote ?? local);
  if (!manifest) throw new Error("No production yet. Import a script or put a production.json in the folder.");

  const files = await collectTakeFiles(dir);
  const registered: string[] = [];
  for (const path of files.keys()) {
    const result = registerTakeFile(manifest, path);
    manifest = result.manifest;
    if (result.changed) registered.push(path);
  }

  // Link first so the manifest commit below snapshots the relinked media.
  const linked: string[] = [];
  const failed: string[] = [];
  const store = useProjectStore.getState();
  for (const shot of manifest.shots) {
    const take = linkedTake(shot);
    const handle = take?.localPath ? files.get(take.localPath) : undefined;
    if (!take || !handle) continue;
    const mediaId = SCRIPT_SHOT_MEDIA_PREFIX + shot.id;
    const media = store.getMediaItem(mediaId);
    if (!media || (!media.isPlaceholder && media.name === take.fileName)) continue;
    const file = await handle.getFile();
    const result = await store.replaceMediaAsset(mediaId, file, dir.name);
    if (result.success) {
      linked.push(take.fileName);
      await saveFileHandle(file.name, file.size, handle).catch(() => undefined);
    } else {
      failed.push(take.fileName);
    }
  }

  // Periodic syncs must not add undo steps or rewrite the file when nothing changed.
  if (linked.length > 0 || !sameManifest(local, manifest)) await commitManifest(manifest);
  if (!sameManifest(remote, manifest)) await writeManifestFile(dir, manifest);
  return { registered, linked, failed, manifest };
}

/**
 * Writes the project's manifest to its folder, if one is connected and
 * allowed. Takes the CLI recorded meanwhile are merged in, not overwritten.
 */
export async function pushProductionToFolder(projectId: string, manifest: ProductionManifest): Promise<boolean> {
  const dir = await getProductionFolder(projectId);
  if (!dir) return false;
  const remote = await readManifestFile(dir).catch(() => null);
  await writeManifestFile(dir, remote ? reconcileProductionManifests(manifest, remote) : manifest);
  return true;
}
