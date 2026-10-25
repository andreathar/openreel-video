import { reachable, unreachableReason, type ImportFlowState, type ImportStep } from "./import-flow";

const STEPS: { step: ImportStep; label: string; name: string }[] = [
  { step: "draft", label: "1 Draft", name: "Draft" },
  { step: "script", label: "2 Script", name: "Script" },
  { step: "shots", label: "3 Shots", name: "Shots" },
];

export function StepHeader({ state, onGoto }: { state: ImportFlowState; onGoto: (step: ImportStep) => void }) {
  const index = STEPS.findIndex((s) => s.step === state.step);
  return (
    <div className="flex gap-1" role="group" aria-label="Import steps">
      {STEPS.map(({ step, label }) => {
        const active = state.step === step;
        const reason = unreachableReason(state, step);
        const reasonId = `import-step-${step}-reason`;
        return (
          <button
            key={step}
            type="button"
            aria-current={active ? "step" : undefined}
            disabled={!reachable(state, step)}
            title={reason ?? undefined}
            aria-describedby={reason ? reasonId : undefined}
            onClick={() => onGoto(step)}
            className={`rounded-md px-3 py-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              active ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            {label}
          </button>
        );
      })}
      {STEPS.map(({ step }) => {
        const reason = unreachableReason(state, step);
        return reason ? (
          <span key={step} id={`import-step-${step}-reason`} className="sr-only">
            {reason}
          </span>
        ) : null;
      })}
      <span role="status" aria-live="polite" className="sr-only">
        {`Step ${index + 1} of ${STEPS.length}: ${STEPS[index].name}`}
      </span>
    </div>
  );
}
