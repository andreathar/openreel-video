import {
  classifyLines, convertDraft, detectDraftKind, normalizeDraft,
  type DraftConversion, type DraftLabels, type StructuredRequester,
} from "@openreel/core";
import type { DirectConnection } from "./agent/direct-llm-transport";
import { makeStructuredRequester } from "./agent/structured-completion";
import { formatChatError } from "../components/editor/chat/ChatErrorCard";

export type FormatOutcome =
  | { kind: "done"; conversion: DraftConversion; notice?: "needs-ai" }
  | { kind: "error"; conversion: DraftConversion; title: string; message: string; details?: string };

/** anthropic/openai need an API key; a compatible (local) server needs only a base URL. */
export function connectionReady(conn: DirectConnection): boolean {
  return conn.provider === "compatible" ? conn.baseUrl.trim() !== "" : conn.apiKey.trim() !== "";
}

const isAbort = (error: unknown, signal?: AbortSignal) =>
  signal?.aborted === true || (error instanceof Error && error.name === "AbortError");

export interface FormatDraftOptions {
  cache: Map<string, DraftLabels>;
  signal?: AbortSignal;
  request?: StructuredRequester;
  /** Lines per model call; tests only. */
  chunkLines?: number;
}

/** Converts a pasted draft to Fountain. The model is called only when the draft needs it and the connection is ready; a failed call keeps the rule result. */
export async function formatDraft(text: string, conn: DirectConnection, options: FormatDraftOptions): Promise<FormatOutcome> {
  const { cache, signal, chunkLines } = options;
  const kind = detectDraftKind(text, classifyLines(normalizeDraft(text).lines));
  if (kind === "fountain") return { kind: "done", conversion: await convertDraft(text, { cache, signal, chunkLines }) };
  if (!connectionReady(conn)) {
    // Only prose needs a model; screenplays format by rules and convertDraft already flags their unsure lines.
    const conversion = await convertDraft(text, { cache, signal, chunkLines });
    return kind === "prose" ? { kind: "done", conversion, notice: "needs-ai" } : { kind: "done", conversion };
  }
  try {
    const conversion = await convertDraft(text, {
      request: options.request ?? makeStructuredRequester(conn),
      parallel: conn.provider === "anthropic" ? 3 : 1,
      cache, signal, chunkLines,
    });
    return { kind: "done", conversion };
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    // Not a retry of the model: the rule-only result stays so the user keeps a usable draft.
    const conversion = await convertDraft(text, { cache, signal, chunkLines });
    const shown = formatChatError(error instanceof Error ? error.message : String(error));
    return { kind: "error", conversion, title: shown.title, message: shown.message, details: shown.details };
  }
}
