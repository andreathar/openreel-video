import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftStep } from "./DraftStep";

const base = { formatting: false, onDraft: vi.fn(), onFormat: vi.fn(), onCancel: vi.fn() };

describe("DraftStep", () => {
  afterEach(() => cleanup());

  it("shows no badge for an empty draft", () => {
    render(<DraftStep {...base} draft="" kind={null} />);
    expect(screen.queryByText("Fountain screenplay")).toBeNull();
  });

  it.each([
    ["fountain", "Fountain screenplay", "Continue"],
    ["screenplay", "Screenplay, needs formatting", "Format script"],
    ["prose", "Prose, AI will find scenes", "Format script"],
  ] as const)("kind %s shows badge and primary label", (kind, badge, label) => {
    render(<DraftStep {...base} draft="text" kind={kind} />);
    expect(screen.getByText(badge)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  });

  it("explains what happens next", () => {
    render(<DraftStep {...base} draft="text" kind="screenplay" />);
    expect(screen.getByText(/done by rules; no AI needed/)).toBeInTheDocument();
    cleanup();
    render(<DraftStep {...base} draft="text" kind="prose" />);
    expect(screen.getByText(/Uses the model in AI settings/)).toBeInTheDocument();
  });

  it("calls onFormat from the primary button", () => {
    const onFormat = vi.fn();
    render(<DraftStep {...base} onFormat={onFormat} draft="text" kind="fountain" />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onFormat).toHaveBeenCalled();
  });

  it("while formatting shows Formatting… and a Cancel that aborts", () => {
    const onCancel = vi.fn();
    render(<DraftStep {...base} onCancel={onCancel} formatting draft="text" kind="prose" />);
    expect(screen.getByRole("button", { name: "Formatting…" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("asks before a dropped file replaces pasted text", async () => {
    const onDraft = vi.fn();
    const { container } = render(<DraftStep {...base} onDraft={onDraft} draft="pasted" kind="prose" />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["from file"], "a.fountain", { type: "text/plain" });
    Object.defineProperty(file, "text", { value: async () => "from file" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText(/Replace the pasted text with a\.fountain\?/)).toBeInTheDocument();
    expect(onDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(onDraft).toHaveBeenCalledWith("from file"));
  });

  it("loads a dropped file directly when the draft is empty", async () => {
    const onDraft = vi.fn();
    const { container } = render(<DraftStep {...base} onDraft={onDraft} draft="" kind={null} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "a.txt", { type: "text/plain" });
    Object.defineProperty(file, "text", { value: async () => "from file" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(onDraft).toHaveBeenCalledWith("from file"));
  });
});
