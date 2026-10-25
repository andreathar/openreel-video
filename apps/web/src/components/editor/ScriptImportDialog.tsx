import { useCallback, useEffect, useMemo, useState, useReducer, useRef } from "react";
import { Clapperboard } from "@/icons/lucide-compat";
import {
  DEFAULT_GENERATION_TARGET_ID,
  GENERATION_TARGETS,
  classifyLines,
  detectDraftKind,
  normalizeDraft,
  parseFountain,
  type DraftConversion,
  type DraftLabels,
} from "@openreel/core";
import {
  ToolcraftButton as Button,
  ToolcraftDialog as Dialog,
  ToolcraftDialogHeader as DialogHeader,
  ToolcraftLayout as Layout,
  ToolcraftLayoutContent as LayoutContent,
} from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useAIConnectionStore } from "../../stores/ai-connection-store";
import { toast } from "../../stores/notification-store";
import { formatDraft, type FormatOutcome } from "../../services/draft-format";
import { formatChatError } from "./chat/ChatErrorCard";
import { effectiveProjectCode, hasHandEdits, importFlowReducer, initialFlow, type ImportStep } from "./script-import/import-flow";
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
  const [codeInput, setCodeInput] = useState(() => useProjectStore.getState().project.production?.projectCode ?? "");
  const [targetId, setTargetId] = useState(() => {
    const saved = useProjectStore.getState().project.production?.defaultTargetId;
    return GENERATION_TARGETS.some((t) => t.id === saved && t.output === "video") ? (saved as string) : DEFAULT_GENERATION_TARGET_ID;
  });

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
    // Only the latest run may finish: a cancelled or superseded run's late result is dropped.
    const isLatest = () => abortRef.current === controller && !controller.signal.aborted;
    try {
      const outcome = await formatDraft(state.draft, useAIConnectionStore.getState(), { cache: cache.current, signal: controller.signal });
      if (!isLatest()) return;
      abortRef.current = null;
      dispatch({ type: "formatDone", outcome });
    } catch (error) {
      if (!isLatest()) return;
      abortRef.current = null;
      dispatch({ type: "formatAborted" });
      if ((error as { name?: unknown } | null)?.name === "AbortError") return;
      const shown = formatChatError(error instanceof Error ? error.message : String(error));
      toast.error(shown.title, shown.message);
    }
  }, [state.draft]);

  /** Format, Continue and Reformat: ask first when step 2 holds hand edits (ruling P6). */
  const requestFormat = useCallback(() => {
    if (hasHandEdits(state)) dispatch({ type: "askReplace" });
    else void runFormat();
  }, [state, runFormat]);

  const cancelFormat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "formatAborted" });
  }, []);

  const close = useCallback(() => {
    if (abortRef.current) cancelFormat();
    onClose();
  }, [onClose, cancelFormat]);

  const openShotBoard = useCallback(() => {
    if (abortRef.current) cancelFormat();
    useUIStore.getState().openModal("shotBoard");
  }, [cancelFormat]);

  const fileName = useMemo(() => {
    const title = state.fountain.trim() ? parseFountain(state.fountain).title : undefined;
    return `${effectiveProjectCode({ typed: codeInput, saved: savedCode, title, projectName })}.fountain`;
  }, [state.fountain, codeInput, savedCode, projectName]);

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
            {state.confirmReplace && (
              <div role="alert" className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
                <span className="flex-1">Replace your edited script? Formatting again discards the changes you made in step 2.</span>
                <Button label="Replace" size="sm" variant="primary" onClick={() => void runFormat()} />
                <Button label="Keep my edits" size="sm" variant="ghost" onClick={() => dispatch({ type: "keepEdits" })} />
              </div>
            )}
            {state.step === "draft" && (
              <DraftStep
                draft={state.draft}
                kind={kind}
                formatting={state.formatting}
                onDraft={(text) => dispatch({ type: "setDraft", text })}
                onFormat={requestFormat}
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
                onReformat={requestFormat}
                onOpenAISettings={close}
                onNext={() => goto("shots")}
                fileName={fileName}
                formatting={state.formatting}
                onCancel={cancelFormat}
              />
            )}
            {state.step === "shots" && (
              <ShotsStep
                fountain={state.fountain}
                code={codeInput}
                savedCode={savedCode}
                onCode={(code) => {
                  setCodeInput(code);
                  dispatch({ type: "unbuilt" });
                }}
                targetId={targetId}
                onTarget={(id) => {
                  setTargetId(id);
                  dispatch({ type: "unbuilt" });
                }}
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
