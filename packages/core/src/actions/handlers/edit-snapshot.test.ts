import { describe, expect, it } from "vitest";
import { getActionHandler } from "../registry";
import { editSnapshot } from "./edit-snapshot";
import type { Project } from "../../types/project";

describe("project/applyEditSnapshot", () => {
  it("clears production when the snapshot has none", () => {
    const base = { name: "p", settings: {}, timeline: { tracks: [] }, mediaLibrary: { items: [] } } as unknown as Project;
    const project = { ...base, production: { version: 1 } } as unknown as Project;
    const handler = getActionHandler("project/applyEditSnapshot");
    handler?.apply({ type: "project/applyEditSnapshot", id: "a", timestamp: 0, params: { snapshot: editSnapshot(base) } }, project, {} as never);
    expect(project.production).toBeUndefined();
    expect("production" in project).toBe(false);
  });
});
