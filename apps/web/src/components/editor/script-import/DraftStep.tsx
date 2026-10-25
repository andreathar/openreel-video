import { useState } from "react";
import type { DraftKind } from "@openreel/core";
import {
  ToolcraftButton as Button,
  ToolcraftFileDropControl as FileInput,
  ToolcraftText as Text,
  ToolcraftTextAreaControl as TextArea,
} from "@openreel/ui";
import { useAIConnectionStore } from "../../../stores/ai-connection-store";

export interface DraftStepProps {
  draft: string;
  kind: DraftKind | null;
  formatting: boolean;
  onDraft: (text: string) => void;
  onFormat: () => void;
  onCancel: () => void;
}

const BADGES: Record<DraftKind, string> = {
  fountain: "Fountain screenplay",
  screenplay: "Screenplay, needs formatting",
  prose: "Prose, AI will find scenes",
};

export function DraftStep({ draft, kind, formatting, onDraft, onFormat, onCancel }: DraftStepProps) {
  const model = useAIConnectionStore((s) => s.model);
  const [pending, setPending] = useState<{ name: string; text: string } | null>(null);

  const handleFile = async (file: File) => {
    const text = await file.text();
    if (draft.trim() !== "") setPending({ name: file.name, text });
    else onDraft(text);
  };

  const hint =
    kind === "prose" ? `Uses the model in AI settings: ${model || "not set"}` : "Formatting is done by rules; no AI needed";

  return (
    <div className="flex flex-col gap-3">
      <FileInput
        label="Script file"
        isLabelHidden
        value={null}
        onChange={(picked) => {
          if (picked instanceof File) void handleFile(picked);
        }}
        accept=".fountain,.txt,.md"
        mode="dropzone"
      />
      {pending && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
          <span className="flex-1">{`Replace the pasted text with ${pending.name}?`}</span>
          <Button
            label="Replace"
            size="sm"
            variant="primary"
            onClick={() => {
              onDraft(pending.text);
              setPending(null);
            }}
          />
          <Button label="Keep" size="sm" variant="ghost" onClick={() => setPending(null)} />
        </div>
      )}
      <TextArea
        label="Script text"
        isLabelHidden
        value={draft}
        onChange={onDraft}
        rows={14}
        placeholder="Paste your script, treatment or story. Any format works."
        width="100%"
      />
      {kind && draft.trim() !== "" && (
        <div className="flex flex-col gap-1">
          <span className="w-fit rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">{BADGES[kind]}</span>
          <Text type="supporting" color="secondary">{hint}</Text>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          label={formatting ? "Formatting…" : kind === "fountain" ? "Continue" : "Format script"}
          variant="primary"
          size="sm"
          isDisabled={formatting || draft.trim() === ""}
          onClick={onFormat}
        />
        {formatting && <Button label="Cancel" variant="ghost" size="sm" onClick={onCancel} />}
      </div>
    </div>
  );
}
