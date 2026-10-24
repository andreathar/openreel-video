import { useCallback, useMemo, useState } from "react";
import { Clapperboard, Copy, Download, Upload } from "@/icons/lucide-compat";
import {
  GENERATION_TARGETS,
  SHOT_STATUSES,
  applyProductionManifest,
  buildShotPrompt,
  getGenerationTarget,
  parseProductionManifest,
  serializeProductionManifest,
  updateProductionShot,
  validateShotTarget,
  type ProductionManifest,
  type ProductionShot,
  type ProductionShotPatch,
  type ShotStatus,
} from "@openreel/core";
import { editSnapshot } from "@openreel/core/actions/handlers/edit-snapshot";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import {
  ToolcraftLayout as Layout,
  ToolcraftLayoutContent as LayoutContent,
  ToolcraftLayoutFooter as LayoutFooter,
} from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { toast } from "../../stores/notification-store";
import { cloneEditSnapshot } from "../../services/agent/editing-session";

interface ShotBoardDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const STATUS_COLORS: Record<ShotStatus, string> = {
  todo: "#6b7280",
  prompted: "#3b82f6",
  queued: "#f59e0b",
  generated: "#8b5cf6",
  selected: "#14b8a6",
  approved: "#10b981",
};

const ALL = "all";

async function saveProduction(production: ProductionManifest): Promise<boolean> {
  const store = useProjectStore.getState();
  const next = applyProductionManifest(store.getFullProject(), production);
  const result = await store.executeAction({
    type: "project/applyEditSnapshot",
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    params: { snapshot: cloneEditSnapshot(editSnapshot(next)) },
  });
  if (!result.success) toast.error("Could not update shot", result.error?.message ?? "Timeline update failed");
  return result.success;
}

function downloadText(text: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** Markdown task list grouped by platform and model, for working through one tool at a time. */
function taskListByTarget(production: ProductionManifest, shots: readonly ProductionShot[]): string {
  const lines = [`# ${production.title ?? production.projectCode} — generation tasks`, ""];
  for (const target of GENERATION_TARGETS) {
    const group = shots.filter((s) => s.targetId === target.id);
    if (group.length === 0) continue;
    lines.push(`## ${target.label} (${target.tool} · ${target.model})`, "");
    for (const shot of group) {
      const { prompt } = buildShotPrompt(shot, production, target);
      const done = shot.status === "approved" || shot.status === "selected";
      lines.push(`- [${done ? "x" : " "}] **${shot.id}** · ${shot.seconds}s · ${shot.heading}`);
      lines.push(`  - Prompt: ${prompt.replace(/\s+/g, " ")}`);
      if (shot.entities.length) lines.push(`  - Entities: ${shot.entities.join(", ")}`);
      const issues = validateShotTarget(shot, production, target);
      if (issues.length) lines.push(`  - ⚠ ${issues.join("; ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export const ShotBoardDialog: React.FC<ShotBoardDialogProps> = ({ isOpen, onClose }) => {
  const production = useProjectStore((state) => (isOpen ? state.project.production : undefined));
  const [scene, setScene] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [targetFilter, setTargetFilter] = useState(ALL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftPrompt, setDraftPrompt] = useState<{ id: string; text: string } | null>(null);

  const scenes = useMemo(() => [...new Set(production?.shots.map((s) => s.sceneCode) ?? [])], [production]);
  const shots = useMemo(
    () =>
      (production?.shots ?? []).filter(
        (s) =>
          (scene === ALL || s.sceneCode === scene) &&
          (status === ALL || s.status === status) &&
          (targetFilter === ALL || s.targetId === targetFilter),
      ),
    [production, scene, status, targetFilter],
  );
  const selected = production?.shots.find((s) => s.id === selectedId) ?? shots[0];
  const counts = useMemo(() => {
    const map = new Map<ShotStatus, number>();
    for (const s of production?.shots ?? []) map.set(s.status, (map.get(s.status) ?? 0) + 1);
    return map;
  }, [production]);

  const patchShot = useCallback(
    async (shotId: string, patch: ProductionShotPatch) => {
      const current = useProjectStore.getState().project.production;
      if (!current) return;
      try {
        await saveProduction(updateProductionShot(current, shotId, patch));
      } catch (error) {
        toast.error("Could not update shot", error instanceof Error ? error.message : String(error));
      }
    },
    [],
  );

  const selectShot = useCallback((shot: ProductionShot) => {
    setSelectedId(shot.id);
    setDraftPrompt(null);
    const clip = useProjectStore
      .getState()
      .project.timeline.tracks.flatMap((t) => t.clips)
      .find((c) => (c.metadata?.script as { shotId?: string } | undefined)?.shotId === shot.id);
    if (clip) {
      useTimelineStore.getState().seekTo(clip.startTime);
      useUIStore.getState().select({ type: "clip", id: clip.id, trackId: clip.trackId });
    }
  }, []);

  const handleImport = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const imported = parseProductionManifest(await file.text());
        if (await saveProduction(imported)) toast.success("Production imported", `${imported.shots.length} shots · ${imported.entities.length} entities`);
      } catch (error) {
        toast.error("Could not import production.json", error instanceof Error ? error.message : String(error));
      }
    };
    input.click();
  }, []);

  if (!isOpen) return null;

  const target = selected ? getGenerationTarget(selected.targetId) : undefined;
  const payload = selected && production && target ? buildShotPrompt(selected, production, target) : undefined;
  const issues = selected && production && target ? validateShotTarget(selected, production, target) : [];
  const promptText = selected && draftPrompt?.id === selected.id ? draftPrompt.text : selected?.prompt ?? "";

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} width={1180} purpose="form">
      <Layout
        header={
          <DialogHeader
            title="Shot Board"
            subtitle={
              production
                ? `${production.projectCode} · ${production.shots.length} shots · ` +
                  SHOT_STATUSES.filter((s) => counts.get(s)).map((s) => `${counts.get(s)} ${s}`).join(" · ")
                : "Import a script to start a production"
            }
            onOpenChange={(open) => !open && onClose()}
            startContent={<Clapperboard size={20} className="text-primary" aria-hidden />}
          />
        }
        content={
          <LayoutContent className="flex h-[74vh] min-h-0 flex-col gap-3 overflow-hidden p-4">
            {!production ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                <Clapperboard size={36} className="text-text-muted" aria-hidden />
                <Text type="body" color="secondary">
                  No production yet. Use Import Script to build shots from a screenplay, or import a production.json.
                </Text>
              </div>
            ) : (
              <>
                <div className="flex items-end gap-2">
                  <Selector label="Scene" value={scene} onChange={setScene} width={140} size="sm"
                    options={[{ value: ALL, label: "All scenes" }, ...scenes.map((s) => ({ value: s, label: s }))]} />
                  <Selector label="Status" value={status} onChange={setStatus} width={140} size="sm"
                    options={[{ value: ALL, label: "All statuses" }, ...SHOT_STATUSES.map((s) => ({ value: s, label: s }))]} />
                  <Selector label="Generator" value={targetFilter} onChange={setTargetFilter} width={260} size="sm"
                    options={[{ value: ALL, label: "All generators" }, ...GENERATION_TARGETS.map((t) => ({ value: t.id, label: t.label }))]} />
                  <div className="flex-1" />
                  <Button label="Copy tasks" size="sm" variant="secondary" icon={<Copy size={14} aria-hidden />}
                    onClick={async () => {
                      await navigator.clipboard.writeText(taskListByTarget(production, shots));
                      toast.success("Tasks copied", `${shots.length} shots grouped by generator`);
                    }} />
                  <Button label="production.json" size="sm" variant="secondary" icon={<Download size={14} aria-hidden />}
                    onClick={() => downloadText(serializeProductionManifest(production), `${production.projectCode}_production.json`, "application/json")} />
                  <Button label="Import" size="sm" variant="ghost" icon={<Upload size={14} aria-hidden />} onClick={handleImport} />
                </div>

                <div className="flex min-h-0 flex-1 gap-3">
                  <div className="min-w-0 flex-1 overflow-auto rounded-lg border border-border custom-scrollbar">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-background-secondary text-left text-text-secondary">
                        <tr>
                          <th className="px-3 py-1.5 font-medium">Shot</th>
                          <th className="px-3 py-1.5 font-medium">Len</th>
                          <th className="px-3 py-1.5 font-medium">Generator</th>
                          <th className="px-3 py-1.5 font-medium">Status</th>
                          <th className="px-3 py-1.5 font-medium">Takes</th>
                          <th className="px-3 py-1.5 font-medium">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shots.map((shot) => {
                          const shotIssues = validateShotTarget(shot, production);
                          return (
                            <tr
                              key={shot.id}
                              onClick={() => selectShot(shot)}
                              className={`cursor-pointer border-t border-border align-top hover:bg-background-tertiary ${selected?.id === shot.id ? "bg-background-tertiary" : ""}`}
                            >
                              <td className="whitespace-nowrap px-3 py-1.5 font-mono">
                                {shot.id}
                                {shot.orphaned && <span className="ml-1 text-text-muted" title="No longer in the script">†</span>}
                              </td>
                              <td className="px-3 py-1.5 tabular-nums">{shot.seconds}s</td>
                              <td className="whitespace-nowrap px-3 py-1.5" title={shotIssues.join("\n")}>
                                {shotIssues.length > 0 && <span className="mr-1 text-amber-500">⚠</span>}
                                {getGenerationTarget(shot.targetId).label}
                              </td>
                              <td className="px-3 py-1.5">
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLORS[shot.status] }} />
                                  {shot.status}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 tabular-nums">{shot.takes.length || ""}</td>
                              <td className="px-3 py-1.5 text-text-secondary">
                                <span className="line-clamp-2">{shot.prompt || shot.description}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {selected && target && (
                    <div className="flex w-[400px] shrink-0 flex-col gap-3 overflow-auto rounded-lg border border-border p-3 custom-scrollbar">
                      <div>
                        <Text type="body" weight="semibold" className="font-mono">{selected.id}</Text>
                        <Text type="supporting" color="secondary">{selected.heading} · {selected.seconds}s</Text>
                      </div>
                      <div className="flex gap-2">
                        <Selector label="Generator" value={selected.targetId} size="sm" width="100%"
                          onChange={(value) => void patchShot(selected.id, { targetId: value })}
                          options={GENERATION_TARGETS.map((t) => ({ value: t.id, label: t.label }))} />
                        <Selector label="Status" value={selected.status} size="sm" width={130}
                          onChange={(value) => void patchShot(selected.id, { status: value as ShotStatus })}
                          options={SHOT_STATUSES.map((s) => ({ value: s, label: s }))} />
                      </div>
                      <Text type="supporting" color="secondary">{target.note}</Text>
                      {issues.length > 0 && (
                        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-500">
                          {issues.map((issue) => <div key={issue}>⚠ {issue}</div>)}
                        </div>
                      )}
                      <label className="flex flex-col gap-1 text-xs text-text-secondary">
                        Prompt
                        <textarea
                          className="min-h-[120px] rounded-md border border-border bg-background-secondary p-2 text-xs text-text-primary"
                          value={promptText}
                          placeholder={selected.description}
                          onChange={(e) => setDraftPrompt({ id: selected.id, text: e.target.value })}
                          onBlur={() => {
                            if (draftPrompt?.id === selected.id && draftPrompt.text !== selected.prompt) {
                              void patchShot(selected.id, { prompt: draftPrompt.text });
                            }
                          }}
                        />
                      </label>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <Text type="supporting" color="secondary" className="flex-1">
                            Payload for {target.tool} · {target.model}
                          </Text>
                          <Button label="Copy" size="sm" variant="secondary" icon={<Copy size={14} aria-hidden />}
                            onClick={async () => {
                              await navigator.clipboard.writeText(payload?.prompt ?? "");
                              toast.success("Prompt copied", selected.id);
                            }} />
                        </div>
                        <pre className="whitespace-pre-wrap rounded-md bg-background-secondary p-2 text-[11px] text-text-secondary">
                          {payload?.prompt}
                          {payload?.elements ? `\n\nelements: ${payload.elements}` : ""}
                        </pre>
                      </div>
                      {selected.entities.length > 0 && (
                        <Text type="supporting" color="secondary">
                          Entities: {selected.entities.join(", ")}
                        </Text>
                      )}
                      {selected.takes.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <Text type="supporting" color="secondary">Takes</Text>
                          {selected.takes.map((take) => (
                            <div key={take.take} className="flex items-center gap-2 text-xs">
                              <button
                                type="button"
                                className={`rounded px-1.5 py-0.5 ${selected.selectedTake === take.take ? "bg-primary text-white" : "bg-background-tertiary"}`}
                                onClick={() => void patchShot(selected.id, { selectedTake: take.take, status: "selected" })}
                              >
                                T{String(take.take).padStart(2, "0")}
                              </button>
                              <span className="font-mono">{take.fileName}</span>
                              <span className="text-text-muted">{take.status}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <Text type="supporting" color="secondary" className="mr-auto">
              Ask the AI chat or Claude Code to create elements and submit shots; generation ids are stored as takes.
            </Text>
            <Button label="Close" variant="ghost" size="sm" onClick={onClose} />
          </LayoutFooter>
        }
      />
    </Dialog>
  );
};

export default ShotBoardDialog;
