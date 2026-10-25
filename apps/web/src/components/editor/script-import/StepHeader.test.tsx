import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialFlow } from "./import-flow";
import { StepHeader } from "./StepHeader";

describe("StepHeader", () => {
  afterEach(() => cleanup());

  it("marks the active step and disables unreachable ones", () => {
    const onGoto = vi.fn();
    render(<StepHeader state={initialFlow()} onGoto={onGoto} />);
    expect(screen.getByRole("button", { name: "1 Draft" })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: "2 Script" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "3 Shots" })).toBeDisabled();
  });

  it("navigates to reachable steps", () => {
    const onGoto = vi.fn();
    render(<StepHeader state={initialFlow("INT. ROOM - DAY\n\nMARA enters.\n")} onGoto={onGoto} />);
    fireEvent.click(screen.getByRole("button", { name: "3 Shots" }));
    expect(onGoto).toHaveBeenCalledWith("shots");
  });
});
