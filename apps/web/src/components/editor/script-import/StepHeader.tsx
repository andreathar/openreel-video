import { reachable, type ImportFlowState, type ImportStep } from "./import-flow";

const STEPS: { step: ImportStep; label: string }[] = [
  { step: "draft", label: "1 Draft" },
  { step: "script", label: "2 Script" },
  { step: "shots", label: "3 Shots" },
];

export function StepHeader({ state, onGoto }: { state: ImportFlowState; onGoto: (step: ImportStep) => void }) {
  return (
    <div className="flex gap-1" role="group" aria-label="Import steps">
      {STEPS.map(({ step, label }) => {
        const active = state.step === step;
        return (
          <button
            key={step}
            type="button"
            aria-current={active ? "step" : undefined}
            disabled={!reachable(state, step)}
            onClick={() => onGoto(step)}
            className={`rounded-md px-3 py-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              active ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
