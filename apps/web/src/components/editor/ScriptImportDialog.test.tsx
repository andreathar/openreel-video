import "../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScriptImportDialog } from "./ScriptImportDialog";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { createEmptyProject } from "../../stores/project/project-helpers";

const SCRIPT = "Title: Vault\n\nINT. VAULT - NIGHT\n\nMara drops onto the floor.\n\nMARA\nThree minutes.\n\nEXT. ROOF - DAWN\n\nShe runs.\n\nINT. CAR - DAY\n\nThey drive.\n";

vi.mock("../../services/draft-format", async (orig) => {
  const actual = await orig<typeof import("../../services/draft-format")>();
  return {
    ...actual,
    formatDraft: vi.fn(async (text: string) => ({
      kind: "done",
      conversion: {
        fountain: text, kind: "fountain", usedAI: false, labels: {},
        check: { ok: true, problems: [], missingWords: [], addedWords: [] },
        flagged: [], addedHeadings: 0, dropped: [],
      },
    })),
  };
});

vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

describe("ScriptImportDialog", () => {
  beforeEach(() => {
    useProjectStore.getState().createNewProject("Vault Heist");
  });
  afterEach(() => cleanup());

  it("walks draft, script and shots, builds, and opens the shot board", async () => {
    const openModal = vi.fn();
    useUIStore.setState({ openModal });
    render(<ScriptImportDialog isOpen onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Script text" }), { target: { value: SCRIPT } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("button", { name: "Use this script" });
    fireEvent.click(screen.getByRole("button", { name: "Use this script" }));

    await screen.findByText(/Creates 3 scene markers/);
    fireEvent.click(screen.getByRole("button", { name: "Build timeline" }));
    await screen.findByText("Timeline built");

    expect(useProjectStore.getState().project.production?.script).toBe(SCRIPT);
    fireEvent.click(screen.getByRole("button", { name: "Open Shot Board" }));
    expect(openModal).toHaveBeenCalledWith("shotBoard");

    await useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.production).toBeUndefined();
  });

  it("starts on step 2 when the project has a saved script", () => {
    const project = createEmptyProject("Saved");
    useProjectStore.setState({
      project: { ...project, production: { version: 1, projectCode: "VLT", defaultTargetId: "x", entities: [], shots: [], script: SCRIPT, updatedAt: 0 } } as never,
      hasOpenProject: true,
    });
    render(<ScriptImportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Use this script" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^2 Script/ })).toHaveAttribute("aria-current", "step");
  });
});
