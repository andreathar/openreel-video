import "../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScriptImportDialog } from "./ScriptImportDialog";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useNotificationStore } from "../../stores/notification-store";
import { formatDraft, type FormatOutcome } from "../../services/draft-format";

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

function doneWith(fountain: string): FormatOutcome {
  return {
    kind: "done",
    conversion: {
      fountain, kind: "fountain", usedAI: false, labels: {} as never,
      check: { ok: true, problems: [], missingWords: [], addedWords: [] },
      flagged: [], addedHeadings: 0, dropped: [],
    },
  };
}

/** A format run the test settles by hand; it ignores the abort signal like a slow request would. */
function deferredRun() {
  let resolve!: (o: FormatOutcome) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<FormatOutcome>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  vi.mocked(formatDraft).mockImplementationOnce(() => promise);
  return { resolve, reject };
}

const errors = () => useNotificationStore.getState().notifications.filter((n) => n.type === "error");

describe("ScriptImportDialog", () => {
  beforeEach(() => {
    useProjectStore.getState().createNewProject("Vault Heist");
    useNotificationStore.setState({ notifications: [] });
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

  function seedSaved() {
    const project = createEmptyProject("Other Name");
    useProjectStore.setState({
      project: { ...project, production: { version: 1, projectCode: "VLT", defaultTargetId: "x", entities: [], shots: [], script: SCRIPT, updatedAt: 0 } } as never,
      hasOpenProject: true,
    });
  }

  it("defaults to the saved project code and rebuilds with it", async () => {
    seedSaved();
    render(<ScriptImportDialog isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Use this script" }));
    expect(await screen.findByDisplayValue("VLT")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /(Re)?build timeline/i }));
    await screen.findByText("Timeline built");
    const p = useProjectStore.getState().project.production!;
    expect(p.script).toBe(SCRIPT);
    expect(p.projectCode).toBe("VLT");
    expect(p.shots.every((s) => s.id.startsWith("VLT_S"))).toBe(true);
  });

  it("keeps a typed code when going back to step 2 and returning", async () => {
    seedSaved();
    render(<ScriptImportDialog isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Use this script" }));
    fireEvent.change(await screen.findByDisplayValue("VLT"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: /^2 Script/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Use this script" }));
    expect(await screen.findByDisplayValue("ABC")).toBeInTheDocument();
  });

  it("asks before replacing hand edits and keeps them on Keep my edits", async () => {
    seedSaved();
    render(<ScriptImportDialog isOpen onClose={vi.fn()} />);
    const edited = SCRIPT + "\nMY EDIT.\n";
    fireEvent.change(screen.getByRole("textbox", { name: "Fountain" }), { target: { value: edited } });
    fireEvent.click(screen.getByRole("button", { name: /^1 Draft/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Script text" }), { target: { value: SCRIPT + "\nINT. NEW - DAY\n" } });
    fireEvent.click(screen.getByRole("button", { name: /^2 Script/ }));
    expect(screen.getByRole("textbox", { name: "Fountain" })).toHaveValue(edited);

    const calls = vi.mocked(formatDraft).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Reformat" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Replace your edited script?");
    expect(vi.mocked(formatDraft).mock.calls.length).toBe(calls);
    fireEvent.click(screen.getByRole("button", { name: "Keep my edits" }));
    expect(screen.getByRole("textbox", { name: "Fountain" })).toHaveValue(edited);

    fireEvent.click(screen.getByRole("button", { name: "Reformat" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    await vi.waitFor(() => expect(screen.getByRole("textbox", { name: "Fountain" })).toHaveValue(SCRIPT + "\nINT. NEW - DAY\n"));
  });

  it("asks from step 1 too, and goes to step 2 when the edits are kept", () => {
    seedSaved();
    render(<ScriptImportDialog isOpen onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Fountain" }), { target: { value: SCRIPT + "\nMINE.\n" } });
    fireEvent.click(screen.getByRole("button", { name: /^1 Draft/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Replace your edited script?");
    fireEvent.click(screen.getByRole("button", { name: "Keep my edits" }));
    expect(screen.getByRole("textbox", { name: "Fountain" })).toHaveValue(SCRIPT + "\nMINE.\n");
  });

  it("shows step 2 busy and read-only during a reformat, and Cancel stops it", async () => {
    seedSaved();
    vi.mocked(formatDraft).mockClear();
    const run = deferredRun();
    render(<ScriptImportDialog isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reformat" }));
    expect(screen.getByRole("textbox", { name: "Fountain" })).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Formatting…" })).toBeDisabled();
    const signal = vi.mocked(formatDraft).mock.calls[0][2].signal!;
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole("textbox", { name: "Fountain" })).not.toHaveAttribute("readonly");
    run.resolve(doneWith("INT. LATE - DAY\n"));
    await Promise.resolve();
    expect(screen.getByRole("textbox", { name: "Fountain" })).toHaveValue(SCRIPT);
  });

  it("lets only the latest run finish a format, and toasts a non-abort error", async () => {
    seedSaved();
    const first = deferredRun();
    const second = deferredRun();
    render(<ScriptImportDialog isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reformat" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Reformat" }));
    first.reject(new DOMException("Aborted", "AbortError"));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole("button", { name: "Formatting…" })).toBeInTheDocument();
    expect(errors()).toHaveLength(0);

    second.reject(new Error("Network down"));
    await screen.findByRole("button", { name: "Reformat" });
    expect(errors()).toHaveLength(1);
  });

  it("uses the saved code when the code field is emptied, for both build and download", async () => {
    seedSaved();
    render(<ScriptImportDialog isOpen onClose={vi.fn()} />);
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    fireEvent.click(screen.getByRole("button", { name: "Use this script" }));
    fireEvent.change(await screen.findByDisplayValue("VLT"), { target: { value: "" } });
    expect(screen.getByText("Shots will be named VLT_S001_SH01")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /(Re)?build timeline/i }));
    await screen.findByText("Timeline built");
    expect(useProjectStore.getState().project.production!.projectCode).toBe("VLT");
    fireEvent.click(screen.getByRole("button", { name: /^2 Script/ }));
    fireEvent.click(screen.getByRole("button", { name: "Download .fountain" }));
    expect(clicked).toEqual(["VLT.fountain"]);
  });

  it("clears Timeline built when the code or model changes", async () => {
    seedSaved();
    render(<ScriptImportDialog isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Use this script" }));
    fireEvent.click(await screen.findByRole("button", { name: /(Re)?build timeline/i }));
    await screen.findByText("Timeline built");
    fireEvent.change(screen.getByDisplayValue("VLT"), { target: { value: "NEW" } });
    expect(screen.queryByText("Timeline built")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rebuild timeline" })).toBeInTheDocument();
  });

  it("toasts when copying the shot list fails", async () => {
    seedSaved();
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => { throw new Error("denied"); }) }, configurable: true });
    render(<ScriptImportDialog isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Use this script" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy task list" }));
    await vi.waitFor(() => expect(errors().map((n) => n.title)).toContain("Copy failed"));
  });
});
