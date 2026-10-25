import { useCallback, useMemo, useState } from "react";
import { Clapperboard, Copy, Download } from "@/icons/lucide-compat";
import {
  GENERATION_TARGETS,
  SCRIPT_SHOTS_TRACK_ID,
  SHOT_DURATION_PROFILES,
  buildScriptTimeline,
  deriveProjectCode,
  formatEighths,
  normalizeProjectCode,
  parseFountain,
  planProduction,
} from "@openreel/core";
import { editSnapshot } from "@openreel/core/actions/handlers/edit-snapshot";
import {
  ToolcraftButton as Button,
  ToolcraftSelectControl as Selector,
  ToolcraftText as Text,
  ToolcraftTextInputControl as TextInput,
} from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { toast } from "../../../stores/notification-store";
import { cloneEditSnapshot } from "../../../services/agent/editing-session";
import { SCENE_COLORS, downloadText, formatSeconds, renderSlate, shotListCsv, shotListMarkdown } from "./shot-list-export";

export interface ShotsStepProps {
  fountain: string;
  code: string;
  onCode: (code: string) => void;
  targetId: string;
  onTarget: (id: string) => void;
  built: boolean;
  onBuilt: () => void;
  onOpenShotBoard: () => void;
  onClose: () => void;
}

const VIDEO_TARGETS = GENERATION_TARGETS.filter((t) => t.output === "video");

function profileFor(targetId: string) {
  const target = GENERATION_TARGETS.find((t) => t.id === targetId);
  return SHOT_DURATION_PROFILES.find((p) => p.id === target?.profileId) ?? SHOT_DURATION_PROFILES[0];
}

export function ShotsStep({ fountain, code: codeInput, onCode, targetId, onTarget, built, onBuilt, onOpenShotBoard, onClose }: ShotsStepProps) {
  const [isBuilding, setIsBuilding] = useState(false);
  const hasScriptTrack = useProjectStore((s) => s.project.timeline.tracks.some((t) => t.id === SCRIPT_SHOTS_TRACK_ID));
  const projectName = useProjectStore((s) => s.project.name);

  const doc = useMemo(() => (fountain.trim() ? parseFountain(fountain) : null), [fountain]);
  const projectCode = normalizeProjectCode(codeInput || deriveProjectCode(doc?.title ?? projectName ?? "") || "PROJ");
  const profile = profileFor(targetId);
  const plan = useMemo(
    () => (doc && doc.scenes.length ? planProduction(doc, { projectCode, profileId: profile.id }) : null),
    [doc, projectCode, profile.id],
  );
  const shotCount = plan?.scenes.reduce((n, s) => n + s.shots.length, 0) ?? 0;

  const handleBuild = useCallback(async () => {
    if (!plan) return;
    setIsBuilding(true);
    try {
      const store = useProjectStore.getState();
      const sceneColor = new Map(plan.scenes.map((s, i) => [s.code, SCENE_COLORS[i % SCENE_COLORS.length]]));
      const next = buildScriptTimeline(store.getFullProject(), plan, {
        thumbnailFor: (shot, scene) => renderSlate(shot, scene, sceneColor.get(scene.code) ?? "#888"),
        defaultTargetId: targetId,
        script: fountain,
      });
      const result = await store.executeAction({
        type: "project/applyEditSnapshot",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { snapshot: cloneEditSnapshot(editSnapshot(next)) },
      });
      if (!result.success) throw new Error(result.error?.message ?? "Timeline update failed");
      toast.success("Script timeline built", `${plan.scenes.length} scenes · ${shotCount} shots · ${formatSeconds(plan.totalSeconds)}`);
      onBuilt();
    } catch (error) {
      toast.error("Could not build timeline", error instanceof Error ? error.message : String(error));
    } finally {
      setIsBuilding(false);
    }
  }, [plan, shotCount, targetId, fountain, onBuilt]);

  const handleCopyList = useCallback(async () => {
    if (!plan) return;
    await navigator.clipboard.writeText(shotListMarkdown(plan, profile.label));
    toast.success("Shot list copied", "Markdown task list on the clipboard");
  }, [plan, profile.label]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Selector
          label="Video model"
          value={targetId}
          onChange={onTarget}
          options={VIDEO_TARGETS.map((t) => {
            const p = SHOT_DURATION_PROFILES.find((x) => x.id === t.profileId) ?? SHOT_DURATION_PROFILES[0];
            return { value: t.id, label: `${t.label}, ${p.minSeconds}–${p.maxSeconds} s shots` };
          })}
          width={360}
        />
        <TextInput label="Project code" value={codeInput} onChange={(v) => onCode(v.toUpperCase())} placeholder={projectCode} maxLength={6} width={120} />
        <Text type="supporting" color="secondary">{`Shots will be named ${projectCode}_S001_SH01`}</Text>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border">
        {plan ? (
          <>
            <div className="flex items-center gap-3 border-b border-border px-3 py-2">
              <Text type="body" weight="semibold" className="flex-1">
                {plan.title ?? "Untitled"} · {plan.scenes.length} scenes · {shotCount} shots · {formatSeconds(plan.totalSeconds)}
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
                    <th className="px-3 py-1.5 font-medium">Est. length</th>
                    <th className="px-3 py-1.5 font-medium">Shots</th>
                    <th className="px-3 py-1.5 font-medium">Cast</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.scenes.map((scene, idx) => (
                    <tr key={scene.code} className="border-t border-border align-top">
                      <td className="px-3 py-1.5 font-mono" style={{ color: SCENE_COLORS[idx % SCENE_COLORS.length] }}>{scene.code}</td>
                      <td className="px-3 py-1.5">{scene.heading}</td>
                      <td className="px-3 py-1.5 tabular-nums" title={formatEighths(scene.estimate.eighths)}>
                        {(scene.estimate.eighths / 8).toFixed(1)}
                      </td>
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
            <Text type="body" color="secondary">No scene headings found. Start scenes with INT. / EXT. or a leading period.</Text>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {hasScriptTrack && !built && (
          <Text type="supporting" color="secondary" className="mr-auto">
            Rebuilding replaces the SHOTS track and scene markers; shots already relinked to real files are kept.
          </Text>
        )}
        {plan && !built && (
          <Text type="supporting" color="secondary" className="ml-auto">
            {`Creates ${plan.scenes.length} scene markers and ${shotCount} placeholder shots`}
          </Text>
        )}
        {built && <Text type="body" weight="semibold" className="mr-auto">Timeline built</Text>}
        {built ? (
          <Button label="Open Shot Board" variant="primary" size="sm" onClick={onOpenShotBoard} />
        ) : (
          <Button
            label={isBuilding ? "Building…" : hasScriptTrack ? "Rebuild timeline" : "Build timeline"}
            variant="primary"
            size="sm"
            isDisabled={!plan || isBuilding}
            onClick={handleBuild}
          />
        )}
        <Button label="Close" variant="ghost" size="sm" onClick={onClose} />
      </div>
    </div>
  );
}
