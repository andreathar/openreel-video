import { describe, expect, it } from "vitest";
import { executeTool } from "./executor";
import { HeadlessHost } from "./headless-host";
import { makeEmptyProject } from "./test-fixtures";

const SCRIPT = `Title: The Heist

INT. VAULT - NIGHT

Mara drops onto the marble floor and freezes as the laser grid sweeps past.

MARA
Three minutes. Not one second more.

EXT. ROOFTOP - CONTINUOUS

Dex waits by the rope, scanning the street below.
`;

describe("script tools", () => {
  it("builds a SHOTS track and lists its shots", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const dry = await executeTool("import_script", { fountain: SCRIPT, projectCode: "HSTL", dryRun: true }, host);
    expect(dry.ok).toBe(true);
    expect(host.getProject().timeline.tracks.some((t) => t.id === "script-shots")).toBe(false);

    const built = await executeTool("import_script", { fountain: SCRIPT, projectCode: "HSTL" }, host);
    expect(built.ok).toBe(true);
    const project = host.getProject();
    expect(project.timeline.markers.filter((m) => m.kind === "scene")).toHaveLength(2);

    const listed = await executeTool("list_script_shots", {}, host);
    const shots = (listed.data as { shots: { shotId: string; linked: boolean }[] }).shots;
    expect(shots[0].shotId).toBe("HSTL_S001_SH01");
    expect(shots.every((s) => !s.linked)).toBe(true);
  });

  it("tracks entities, prompts and takes in the production manifest", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool("import_script", { fountain: SCRIPT, projectCode: "HSTL" }, host);

    const entity = await executeTool("upsert_entity", { kind: "CHR", displayName: "MARA", kling: { elementId: "321", type: "image" } }, host);
    expect((entity.data as { entity: { code: string } }).entity.code).toBe("HSTL-CHR-MARA");

    const updated = await executeTool("update_shot", { shotId: "HSTL_S001_SH01", prompt: "Mara lands in the vault" }, host);
    expect(updated.ok).toBe(true);

    const payload = await executeTool("get_shot_prompt", { shotId: "HSTL_S001_SH01" }, host);
    const data = payload.data as { prompt: string; elements: string; target: { tool: string; model: string } };
    expect(data.prompt).toBe("<<<321>>> lands in the vault");
    expect(data.target).toEqual(expect.objectContaining({ tool: "omni_ref_video", model: "kling-video-v4_0" }));

    const take = await executeTool("record_take", { shotId: "HSTL_S001_SH01", generationId: "gen-9" }, host);
    expect((take.data as { take: { fileName: string } }).take.fileName).toBe("HSTL_S001_SH01_kl-v4_T01.mp4");

    const clip = host.getProject().timeline.tracks.find((t) => t.id === "script-shots")!.clips[0];
    expect((clip.metadata?.script as { status: string }).status).toBe("queued");

    const bad = await executeTool("update_shot", { shotId: "HSTL_S001_SH01", targetId: "nope" }, host);
    expect(bad.ok).toBe(false);
  });
});
