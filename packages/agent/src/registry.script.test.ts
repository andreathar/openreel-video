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
});
