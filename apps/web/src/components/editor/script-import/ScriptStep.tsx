import { useMemo } from "react";
import { Copy, Download } from "@/icons/lucide-compat";
import { formatScriptSummary, parseFountain, summarizeScript, type DraftConversion } from "@openreel/core";
import { ToolcraftButton as Button, ToolcraftText as Text, ToolcraftTextAreaControl as TextArea } from "@openreel/ui";
import type { FormatOutcome } from "../../../services/draft-format";
import { useSettingsStore } from "../../../stores/settings-store";
import { toast } from "../../../stores/notification-store";

export interface ScriptStepProps {
  draft: string;
  fountain: string;
  conversion: DraftConversion;
  outcome: FormatOutcome | null;
  onEdit: (fountain: string) => void;
  onReformat: () => void;
  onOpenAISettings?: () => void;
  onNext: () => void;
  /** Download name, e.g. `PROJ.fountain`. */
  fileName?: string;
  /** A format run is in flight: the Fountain is read-only and Cancel stops the run. */
  formatting?: boolean;
  onCancel?: () => void;
}

const AI_MARKER = /\s*\[\[added by AI\]\]\s*$/;
const HEADING = /^(?:INT\.?|EXT\.?|EST\.?|INT\.?\/EXT\.?|I\/E|\.[A-Za-z])/i;

function downloadText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ScriptStep({
  draft,
  fountain,
  conversion,
  outcome,
  onEdit,
  onReformat,
  onOpenAISettings,
  onNext,
  fileName = "script.fountain",
  formatting = false,
  onCancel,
}: ScriptStepProps) {
  const doc = useMemo(() => parseFountain(fountain), [fountain]);
  const summary = useMemo(() => formatScriptSummary(summarizeScript(doc)), [doc]);
  const hasScenes = doc.scenes.length > 0;
  const headings = useMemo(() => fountain.split("\n").filter((l) => HEADING.test(l.trim())), [fountain]);
  const draftLines = useMemo(() => draft.split(/\r?\n/), [draft]);
  const { check } = conversion;
  const problems = check.problems.length;
  const hasAddedHeadings = conversion.addedHeadings > 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fountain);
      toast.success("Fountain copied", "On the clipboard");
    } catch {
      toast.error("Copy failed", "The browser blocked clipboard access");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Text type="supporting">{summary}</Text>
      {formatting && (
        <div role="status" aria-busy="true" className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
          <span className="flex-1">Formatting your draft… The script below is read-only until it finishes.</span>
        </div>
      )}

      {outcome?.kind === "done" && outcome.notice === "needs-ai" && (
        <div role="status" className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
          <span className="flex-1">Prose needs the AI assistant to find scenes. Set it up in AI settings.</span>
          <Button
            label="Open AI settings"
            size="sm"
            variant="secondary"
            onClick={() => {
              useSettingsStore.getState().openSettings("ai-editor");
              onOpenAISettings?.();
            }}
          />
        </div>
      )}
      {outcome?.kind === "error" && (
        <div role="alert" className="rounded-md border border-destructive p-2 text-sm">
          <div className="font-medium">{outcome.title}</div>
          <div>{outcome.message}</div>
          {outcome.details && (
            <details>
              <summary className="cursor-pointer text-xs">Details</summary>
              <pre className="whitespace-pre-wrap text-xs">{outcome.details}</pre>
            </details>
          )}
        </div>
      )}
      {conversion.flagged.map((f) => (
        <div key={`${f.fromLine}-${f.toLine}`} className="text-sm">{`Lines ${f.fromLine}–${f.toLine}: check this part — ${f.reason}`}</div>
      ))}
      {conversion.dropped.length > 0 && (
        <div className="text-sm">
          {"Removed as page clutter: "}
          {conversion.dropped.map((d, i) => (
            <span key={i}>
              {i > 0 && ", "}
              <code>{d}</code>
            </span>
          ))}
        </div>
      )}
      {check.missingWords.length > 0 && (
        <div className="text-sm">{`Missing from the result (${check.missingWords.length}): ${check.missingWords.join(", ")}`}</div>
      )}
      {check.addedWords.length > 0 && (
        <div className="text-sm">{`Added (${check.addedWords.length}): ${check.addedWords.join(", ")}`}</div>
      )}
      {hasAddedHeadings && (
        <div className="text-sm">
          {`${conversion.addedHeadings} scene ${conversion.addedHeadings === 1 ? "heading was" : "headings were"} added by AI — marked `}
          <code>[[added by AI]]</code>.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 min-[900px]:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Text type="supporting" weight="medium">Your draft</Text>
          <pre className="max-h-96 overflow-auto rounded-md border border-border p-2 text-xs" role="region" aria-label="Your draft">
            {draftLines.map((line, i) => (
              <div key={i} className="flex gap-2">
                <span className="w-8 shrink-0 select-none text-right text-muted-foreground">{i + 1}</span>
                <span className="whitespace-pre-wrap">{line}</span>
              </div>
            ))}
          </pre>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          {headings.length > 0 && (
            <ul className="text-xs" aria-label="Scene headings">
              {headings.map((h, i) =>
                AI_MARKER.test(h) ? (
                  <li key={i} data-testid="heading-added" className="rounded bg-yellow-500/20 px-1">{h.trim().replace(AI_MARKER, "").replace(/^\./, "")}</li>
                ) : (
                  <li key={i} className="px-1">{h.trim().replace(/^\./, "")}</li>
                ),
              )}
            </ul>
          )}
          <TextArea label="Fountain" value={fountain} onChange={onEdit} readOnly={formatting} rows={16} width="100%" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button label={formatting ? "Formatting…" : "Reformat"} size="sm" variant="secondary" isDisabled={formatting} onClick={onReformat} />
        {formatting && <Button label="Cancel" size="sm" variant="ghost" onClick={onCancel} />}
        <Button label="Copy Fountain" size="sm" variant="secondary" icon={<Copy size={14} aria-hidden />} onClick={() => void copy()} />
        <Button
          label="Download .fountain"
          size="sm"
          variant="secondary"
          icon={<Download size={14} aria-hidden />}
          onClick={() => downloadText(fountain, fileName)}
        />
        <Button
          label={problems > 0 ? `Use this script (${problems} problem${problems === 1 ? "" : "s"})` : "Use this script"}
          size="sm"
          variant="primary"
          isDisabled={!hasScenes || formatting}
          aria-describedby={hasScenes ? undefined : "script-step-no-scenes"}
          onClick={onNext}
        />
        {!hasScenes && (
          <Text type="supporting" color="secondary" id="script-step-no-scenes">
            No scene headings found. Start scenes with INT. / EXT. or a leading period.
          </Text>
        )}
      </div>
    </div>
  );
}
