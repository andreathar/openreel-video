import type { PlannedScene, PlannedShot, ProductionBreakdown } from "@openreel/core";

export const SCENE_COLORS = ["#f59e0b", "#3b82f6", "#10b981", "#ef4444", "#8b5cf6", "#ec4899"];

export function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

/** Slate frame for a shot's placeholder so the media library reads like a stripboard. */
export function renderSlate(shot: PlannedShot, scene: PlannedScene, color: string): string | null {
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

/** Markdown task list: one checkbox per shot, grouped by scene. */
export function shotListMarkdown(plan: ProductionBreakdown, profileLabel: string): string {
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

export function shotListCsv(plan: ProductionBreakdown): string {
  const rows = [["shot_id", "scene", "heading", "seconds", "characters", "description", "status"]];
  for (const scene of plan.scenes) {
    for (const shot of scene.shots) {
      rows.push([shot.id, scene.code, scene.heading, String(shot.seconds), shot.characters.join(" "), shot.description, "todo"]);
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function downloadText(text: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
