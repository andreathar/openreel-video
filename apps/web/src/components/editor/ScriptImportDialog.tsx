import { useCallback, useMemo, useState } from "react";
import { Clapperboard, Copy, Download } from "@/icons/lucide-compat";
import {
  DEFAULT_SHOT_PROFILE_ID,
  SCRIPT_SHOTS_TRACK_ID,
  SHOT_DURATION_PROFILES,
  buildScriptTimeline,
  deriveProjectCode,
  formatEighths,
  normalizeProjectCode,
  parseFountain,
  planProduction,
  type PlannedScene,
  type PlannedShot,
  type ProductionBreakdown,
} from "@openreel/core";
import { editSnapshot } from "@openreel/core/actions/handlers/edit-snapshot";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftFileDropControl as FileInput } from "@openreel/ui";
import {
  ToolcraftLayout as Layout,
  ToolcraftLayoutContent as LayoutContent,
  ToolcraftLayoutFooter as LayoutFooter,
} from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextAreaControl as TextArea } from "@openreel/ui";
import { ToolcraftTextInputControl as TextInput } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { toast } from "../../stores/notification-store";
import { cloneEditSnapshot } from "../../services/agent/editing-session";

interface ScriptImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

/** Slate frame for a shot's placeholder so the media library reads like a stripboard. */
function renderSlate(shot: PlannedShot, scene: PlannedScene, color: string): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, 320, 180);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 6, 180);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 20px ui-monospace, monospace";
  ctx.fillText(shot.id, 18, 34);
  ctx.font = "13px system-ui, sans-serif";
  ctx.fillStyle = "#bbb";
  ctx.fillText(scene.heading.slice(0, 40), 18, 58);
  ctx.fillText(`${shot.seconds}s${shot.characters.length ? " · " + shot.characters.join(", ") : ""}`.slice(0, 44), 18, 78);
  ctx.fillStyle = "#888";
  const words = shot.description.split(/\s+/);
  let line = "";
  let y = 104;
  for (const word of words) {
    if (ctx.measureText(`${line} ${word}`).width > 286) {
      ctx.fillText(line, 18, y);
      y += 16;
      line = word;
      if (y > 168) break;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (y <= 168) ctx.fillText(line, 18, y);
  return canvas.toDataURL("image/jpeg", 0.8);
}

const SCENE_COLORS = ["#f59e0b", "#3b82f6", "#10b981", "#ef4444", "#8b5cf6", "#ec4899"];

/** Markdown task list: one checkbox per shot, grouped by scene. */
function shotListMarkdown(plan: ProductionBreakdown, profileLabel: string): string {
  const lines = [
    `# ${plan.title ?? plan.projectCode} — shot list`,
    "",
    `Model profile: ${profileLabel} · ${plan.scenes.length} scenes · ${formatSeconds(plan.totalSeconds)}`,
    "",
  ];
  for (const scene of plan.scenes) {
    lines.push(`## ${scene.code} · ${scene.heading} (${formatSeconds(scene.seconds)})`, "");
    for (const shot of scene.shots) {
      const cast = shot.characters.length ? ` [${shot.characters.join(", ")}]` : "";
      lines.push(`- [ ] **${shot.id}** · ${shot.seconds}s${cast} — ${shot.description}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function shotListCsv(plan: ProductionBreakdown): string {
  const rows = [["shot_id", "scene", "heading", "seconds", "characters", "description", "status"]];
  for (const scene of plan.scenes) {
    for (const shot of scene.shots) {
      rows.push([shot.id, scene.code, scene.heading, String(shot.seconds), shot.characters.join(" "), shot.description, "todo"]);
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function downloadText(text: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const ScriptImportDialog: React.FC<ScriptImportDialogProps> = ({ isOpen, onClose }) => {
  const [source, setSource] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [profileId, setProfileId] = useState(DEFAULT_SHOT_PROFILE_ID);
  const [isBuilding, setIsBuilding] = useState(false);
  const hasScriptTrack = useProjectStore((state) =>
    isOpen ? state.project.timeline.tracks.some((t) => t.id === SCRIPT_SHOTS_TRACK_ID) : false,
  );
  const projectName = useProjectStore((state) => (isOpen ? state.project.name : ""));

  const doc = useMemo(() => (source.trim() ? parseFountain(source) : null), [source]);
  const projectCode = normalizeProjectCode(
    codeInput || deriveProjectCode(doc?.title ?? projectName ?? "") || "PROJ",
  );
  const plan = useMemo(
    () => (doc && doc.scenes.length ? planProduction(doc, { projectCode, profileId }) : null),
    [doc, projectCode, profileId],
  );
  const profile = SHOT_DURATION_PROFILES.find((p) => p.id === profileId) ?? SHOT_DURATION_PROFILES[0];
  const shotCount = plan?.scenes.reduce((n, s) => n + s.shots.length, 0) ?? 0;

  const handleFile = useCallback(async (file: File) => {
    setSource(await file.text());
  }, []);

  const handleBuild = useCallback(async () => {
    if (!plan) return;
    setIsBuilding(true);
    try {
      const store = useProjectStore.getState();
      const sceneColor = new Map(plan.scenes.map((s, i) => [s.code, SCENE_COLORS[i % SCENE_COLORS.length]]));
      const next = buildScriptTimeline(store.getFullProject(), plan, {
        thumbnailFor: (shot, scene) => renderSlate(shot, scene, sceneColor.get(scene.code) ?? "#888"),
      });
      const result = await store.executeAction({
        type: "project/applyEditSnapshot",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { snapshot: cloneEditSnapshot(editSnapshot(next)) },
      });
      if (!result.success) throw new Error(result.error?.message ?? "Timeline update failed");
      toast.success("Script timeline built", `${plan.scenes.length} scenes · ${shotCount} shots · ${formatSeconds(plan.totalSeconds)}`);
      onClose();
    } catch (error) {
      toast.error("Could not build timeline", error instanceof Error ? error.message : String(error));
    } finally {
      setIsBuilding(false);
    }
  }, [plan, shotCount, onClose]);

  const handleCopyList = useCallback(async () => {
    if (!plan) return;
    await navigator.clipboard.writeText(shotListMarkdown(plan, profile.label));
    toast.success("Shot list copied", "Markdown task list on the clipboard");
  }, [plan, profile.label]);

  if (!isOpen) return null;

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} width={1040} purpose="form">
      <Layout
        header={
          <DialogHeader
            title="Import Script"
            subtitle="Fountain screenplay → scene markers and a SHOTS track sized for your video model"
            onOpenChange={(open) => !open && onClose()}
            startContent={<Clapperboard size={20} className="text-primary" aria-hidden />}
          />
        }
        content={
          <LayoutContent className="flex h-[72vh] min-h-0 gap-4 overflow-hidden p-4">
            <div className="flex w-[380px] shrink-0 flex-col gap-3 overflow-auto">
              <FileInput
                label="Screenplay file"
                isLabelHidden
                value={null}
                onChange={(picked) => {
                  if (picked instanceof File) void handleFile(picked);
                }}
                accept=".fountain,.spmd,.txt,.md,text/plain"
                mode="dropzone"
                placeholder="Drop a .fountain file or click to browse"
                description="Fountain (.fountain) or plain-text screenplay"
                width="100%"
              />
              <TextArea
                label="Or paste the script"
                value={source}
                onChange={setSource}
                rows={14}
                placeholder={"INT. VAULT - NIGHT\n\nMara drops onto the marble floor.\n\nMARA\nThree minutes."}
                width="100%"
              />
              <div className="flex gap-2">
                <TextInput
                  label="Project code"
                  value={codeInput}
                  onChange={(v) => setCodeInput(v.toUpperCase())}
                  placeholder={projectCode}
                  maxLength={6}
                  width={120}
                />
                <Selector
                  label="Video model"
                  value={profileId}
                  onChange={setProfileId}
                  options={SHOT_DURATION_PROFILES.map((p) => ({
                    value: p.id,
                    label: `${p.label} (${p.allowedSeconds ? p.allowedSeconds.join("/") : `${p.minSeconds}–${p.maxSeconds}`}s)`,
                  }))}
                  width="100%"
                />
              </div>
              <Text type="supporting" color="secondary">
                Shots are named {projectCode}_S001_SH01 and snapped to the model's allowed lengths.
                Downloaded takes named {projectCode}_S001_SH01_{profile.modelTag}_T01.mp4 relink to their shot.
              </Text>
            </div>

            <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border">
              {plan ? (
                <>
                  <div className="flex items-center gap-3 border-b border-border px-3 py-2">
                    <Text type="body" weight="semibold" className="flex-1">
                      {plan.title ?? "Untitled"} · {plan.scenes.length} scenes · {shotCount} shots ·{" "}
                      {formatSeconds(plan.totalSeconds)}
                    </Text>
                    <Button label="Copy task list" size="sm" variant="secondary" icon={<Copy size={14} aria-hidden />} onClick={handleCopyList} />
                    <Button
                      label="CSV"
                      size="sm"
                      variant="secondary"
                      icon={<Download size={14} aria-hidden />}
                      onClick={() => downloadText(shotListCsv(plan), `${plan.projectCode}_shotlist.csv`, "text/csv")}
                    />
                  </div>
                  <div className="flex-1 overflow-auto custom-scrollbar">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-background-secondary text-left text-text-secondary">
                        <tr>
                          <th className="px-3 py-1.5 font-medium">Scene</th>
                          <th className="px-3 py-1.5 font-medium">Heading</th>
                          <th className="px-3 py-1.5 font-medium">Pages</th>
                          <th className="px-3 py-1.5 font-medium">Length</th>
                          <th className="px-3 py-1.5 font-medium">Shots</th>
                          <th className="px-3 py-1.5 font-medium">Cast</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.scenes.map((scene, idx) => (
                          <tr key={scene.code} className="border-t border-border align-top">
                            <td className="px-3 py-1.5 font-mono" style={{ color: SCENE_COLORS[idx % SCENE_COLORS.length] }}>
                              {scene.code}
                            </td>
                            <td className="px-3 py-1.5">{scene.heading}</td>
                            <td className="px-3 py-1.5 tabular-nums">{formatEighths(scene.estimate.eighths)}</td>
                            <td className="px-3 py-1.5 tabular-nums">{formatSeconds(scene.seconds)}</td>
                            <td className="px-3 py-1.5 tabular-nums" title={scene.shots.map((s) => `${s.id} · ${s.seconds}s`).join("\n")}>
                              {scene.shots.length} × {[...new Set(scene.shots.map((s) => `${s.seconds}s`))].join("/")}
                            </td>
                            <td className="px-3 py-1.5 text-text-secondary">{scene.characters.join(", ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                  <Clapperboard size={36} className="text-text-muted" aria-hidden />
                  <Text type="body" color="secondary">
                    {doc ? "No scene headings found. Start scenes with INT. / EXT. or a leading period." : "Load or paste a screenplay to preview its breakdown."}
                  </Text>
                </div>
              )}
            </div>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            {hasScriptTrack && (
              <Text type="supporting" color="secondary" className="mr-auto">
                Rebuilding replaces the SHOTS track and scene markers; shots already relinked to real files are kept.
              </Text>
            )}
            <Button label="Cancel" variant="ghost" size="sm" onClick={onClose} />
            <Button
              label={isBuilding ? "Building…" : hasScriptTrack ? "Rebuild timeline" : "Build timeline"}
              variant="primary"
              size="sm"
              isDisabled={!plan || isBuilding}
              onClick={handleBuild}
            />
          </LayoutFooter>
        }
      />
    </Dialog>
  );
};
