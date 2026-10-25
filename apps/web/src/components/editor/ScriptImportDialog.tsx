import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { Clapperboard } from "@/icons/lucide-compat";
import {
  classifyLines,
  deriveProjectCode,
  detectDraftKind,
  normalizeDraft,
  normalizeProjectCode,
  parseFountain,
  type DraftConversion,
  type DraftLabels,
} from "@openreel/core";
import {
  ToolcraftDialog as Dialog,
  ToolcraftDialogHeader as DialogHeader,
  ToolcraftLayout as Layout,
  ToolcraftLayoutContent as LayoutContent,
} from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useAIConnectionStore } from "../../stores/ai-connection-store";
import { formatDraft, type FormatOutcome } from "../../services/draft-format";
import { importFlowReducer, initialFlow, type ImportStep } from "./script-import/import-flow";
import { StepHeader } from "./script-import/StepHeader";
import { DraftStep } from "./script-import/DraftStep";
import { ScriptStep } from "./script-import/ScriptStep";
import { ShotsStep } from "./script-import/ShotsStep";

interface ScriptImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Stand-in for a script reopened from the project, which has no conversion report. */
function savedConversion(fountain: string): DraftConversion {
  return {
    fountain,
    kind: "fountain",
    usedAI: false,
    labels: {} as DraftConversion["labels"],
    check: { ok: true, problems: [], missingWords: [], addedWords: [] },
    flagged: [],
    addedHeadings: 0,
    dropped: [],
  };
}

export const ScriptImportDialog: React.FC<ScriptImportDialogProps> = ({ isOpen, onClose }) => {
  const [state, dispatch] = useReducer(importFlowReducer, undefined, () =>
    initialFlow(useProjectStore.getState().project.production?.script),
  );
  const cache = useRef(new Map<string, DraftLabels>());
  const abortRef = useRef<AbortController | null>(null);
  const projectName = useProjectStore((s) => s.project.name);
  const savedCode = useProjectStore((s) => s.project.production?.projectCode);

  useEffect(() => () => abortRef.current?.abort(), []);

  const kind = useMemo(
    () => (state.draft.trim() ? detectDraftKind(state.draft, classifyLines(normalizeDraft(state.draft).lines)) : null),
    [state.draft],
  );

  const runFormat = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ type: "formatStart" });
    try {
      const outcome = await formatDraft(state.draft, useAIConnectionStore.getState(), { cache: cache.current, signal: controller.signal });
      if (controller.signal.aborted) return;
      dispatch({ type: "formatDone", outcome });
    } catch {
      dispatch({ type: "formatAborted" });
    }
  }, [state.draft]);

  const cancelFormat = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: "formatAborted" });
  }, []);

  const close = useCallback(() => {
    abortRef.current?.abort();
    onClose();
  }, [onClose]);

  const openShotBoard = useCallback(() => {
    abortRef.current?.abort();
    useUIStore.getState().openModal("shotBoard");
  }, []);

  const fileName = useMemo(() => {
    const title = state.fountain.trim() ? parseFountain(state.fountain).title : undefined;
    const code = savedCode || (deriveProjectCode(title ?? projectName ?? "") ? normalizeProjectCode(deriveProjectCode(title ?? projectName ?? "")) : "");
    return code ? `${code}.fountain` : "script.fountain";
  }, [state.fountain, savedCode, projectName]);

  const conversion = state.conversion ?? savedConversion(state.fountain);
  const goto = (step: ImportStep) => dispatch({ type: "goto", step });

  if (!isOpen) return null;

  return (
    <Dialog isOpen onOpenChange={(open) => !open && close()} width={1040} purpose="form">
      <Layout
        header={
          <DialogHeader
            title="Import Script"
            subtitle="Draft → Fountain script → scene markers and a SHOTS track"
            onOpenChange={(open) => !open && close()}
            startContent={<Clapperboard size={20} className="text-primary" aria-hidden />}
          />
        }
        content={
          <LayoutContent className="flex h-[72vh] min-h-0 flex-col gap-3 overflow-auto p-4">
            <StepHeader state={state} onGoto={goto} />
            {state.step === "draft" && (
              <DraftStep
                draft={state.draft}
                kind={kind}
                formatting={state.formatting}
                onDraft={(text) => dispatch({ type: "setDraft", text })}
                onFormat={() => void runFormat()}
                onCancel={cancelFormat}
              />
            )}
            {state.step === "script" && (
              <ScriptStep
                draft={state.draft}
                fountain={state.fountain}
                conversion={conversion}
                outcome={state.outcome ? ({ ...state.outcome, conversion } as FormatOutcome) : null}
                onEdit={(text) => dispatch({ type: "editFountain", text })}
                onReformat={() => void runFormat()}
                onOpenAISettings={close}
                onNext={() => goto("shots")}
                fileName={fileName}
              />
            )}
            {state.step === "shots" && (
              <ShotsStep
                fountain={state.fountain}
                built={state.built}
                onBuilt={() => dispatch({ type: "built" })}
                onOpenShotBoard={openShotBoard}
                onClose={close}
              />
            )}
          </LayoutContent>
        }
      />
    </Dialog>
  );
};
