import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DraftConversion } from "@openreel/core";
import type { FormatOutcome } from "../../../services/draft-format";
import { useSettingsStore } from "../../../stores/settings-store";
import { ScriptStep } from "./ScriptStep";

const FOUNTAIN = "INT. ROOM - DAY\n\nMARA enters.\n\nMARA\nHello.\n";

function conv(over: Partial<DraftConversion> = {}): DraftConversion {
  return {
    fountain: FOUNTAIN, kind: "screenplay", usedAI: false, labels: {} as DraftConversion["labels"],
    check: { ok: true, problems: [], missingWords: [], addedWords: [] },
    flagged: [], addedHeadings: 0, dropped: [], ...over,
  };
}

function setup(over: { conversion?: DraftConversion; outcome?: FormatOutcome | null; fountain?: string } & Record<string, unknown> = {}) {
  const conversion = over.conversion ?? conv();
  const props = {
    draft: "INT. ROOM - DAY\nMara enters.",
    fountain: over.fountain ?? conversion.fountain,
    conversion,
    outcome: over.outcome ?? ({ kind: "done", conversion } as FormatOutcome),
    onEdit: vi.fn(), onReformat: vi.fn(), onOpenAISettings: vi.fn(), onNext: vi.fn(),
  };
  render(<ScriptStep {...props} />);
  return props;
}

describe("ScriptStep", () => {
  afterEach(() => cleanup());

  it("shows the summary line for the current Fountain and updates on edit", () => {
    const { rerender } = render(
      <ScriptStep draft="d" fountain={FOUNTAIN} conversion={conv()} outcome={null} onEdit={vi.fn()} onReformat={vi.fn()} onOpenAISettings={vi.fn()} onNext={vi.fn()} />,
    );
    expect(screen.getByText(/1 scene · 1 character · 1 dialogue line/)).toBeInTheDocument();
    rerender(
      <ScriptStep draft="d" fountain={FOUNTAIN + "\nINT. HALL - DAY\n\nJO\nHi.\n"} conversion={conv()} outcome={null} onEdit={vi.fn()} onReformat={vi.fn()} onOpenAISettings={vi.fn()} onNext={vi.fn()} />,
    );
    expect(screen.getByText(/2 scenes · 2 characters · 2 dialogue lines/)).toBeInTheDocument();
  });

  it("reports edits", () => {
    const p = setup();
    fireEvent.change(screen.getByLabelText("Fountain"), { target: { value: "X" } });
    expect(p.onEdit).toHaveBeenCalledWith("X");
  });

  it("needs-ai banner opens AI settings", () => {
    const conversion = conv();
    const spy = vi.fn();
    useSettingsStore.setState({ openSettings: spy });
    const p = setup({ conversion, outcome: { kind: "done", conversion, notice: "needs-ai" } });
    expect(screen.getByText(/Prose needs the AI assistant to find scenes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open AI settings" }));
    expect(spy).toHaveBeenCalledWith("ai-editor");
    expect(p.onOpenAISettings).toHaveBeenCalled();
  });

  it("shows the error with collapsible details", () => {
    const conversion = conv();
    setup({ conversion, outcome: { kind: "error", conversion, title: "Bad key", message: "Check it", details: "HTTP 401" } });
    expect(screen.getByText("Bad key")).toBeInTheDocument();
    expect(screen.getByText("Check it")).toBeInTheDocument();
    expect(screen.getByText("HTTP 401")).toBeInTheDocument();
  });

  it("lists flagged chunks and every dropped line", () => {
    setup({ conversion: conv({ flagged: [{ fromLine: 3, toLine: 9, reason: "unsure speaker" }], dropped: ["2.", "(MORE)"] }) });
    expect(screen.getByText(/Lines 3–9: check this part — unsure speaker/)).toBeInTheDocument();
    expect(screen.getByText(/Removed as page clutter/)).toHaveTextContent("2.");
    expect(screen.getByText(/Removed as page clutter/)).toHaveTextContent("(MORE)");
  });

  it("lists lost and added words with a count", () => {
    setup({ conversion: conv({ check: { ok: false, problems: ["p1", "p2"], missingWords: ["alpha", "beta"], addedWords: ["gamma"] } }) });
    expect(screen.getByText(/Missing from the result \(2\): alpha, beta/)).toBeInTheDocument();
    expect(screen.getByText(/Added \(1\): gamma/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this script (2 problems)" })).toBeInTheDocument();
  });

  it("tints AI-added headings and counts them", () => {
    const fountain = "INT. ROOM - DAY [[added by AI]]\n\nMARA enters.\n";
    setup({ conversion: conv({ fountain, addedHeadings: 1 }), fountain });
    expect(screen.getByText(/1 scene headings? (was|were) added by AI/)).toBeInTheDocument();
    expect(screen.getByTestId("heading-added")).toHaveTextContent("INT. ROOM - DAY");
  });

  it("plain primary label and handlers", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Use this script" }));
    expect(p.onNext).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reformat" }));
    expect(p.onReformat).toHaveBeenCalled();
  });
});
