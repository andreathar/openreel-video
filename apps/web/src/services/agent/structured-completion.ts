import type { StructuredPrompt, StructuredRequester } from "@openreel/core";
import { postToModel, type DirectConnection } from "./direct-llm-transport";

const MAX_TOKENS = 8000;
const TRUNCATED = "The model ran out of output tokens while formatting. Try a shorter draft or a larger model.";

/** Asks the connection's model for schema-constrained JSON (temperature 0) and returns the raw reply text. */
export async function completeStructured(conn: DirectConnection, prompt: StructuredPrompt, signal?: AbortSignal): Promise<string> {
  const model = conn.model.trim();
  if (!model) throw new Error("Enter a model ID that supports structured output.");
  if (conn.provider === "anthropic") {
    const raw = await postToModel(conn, {
      model, max_tokens: MAX_TOKENS, temperature: 0, system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
      output_config: { format: { type: "json_schema", schema: prompt.schema } },
    }, signal) as { content?: Array<{ type?: string; text?: string }>; stop_reason?: string };
    if (raw.stop_reason === "max_tokens") throw new Error(TRUNCATED);
    return (raw.content ?? []).filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
  }
  const raw = await postToModel(conn, {
    model, temperature: 0, max_tokens: MAX_TOKENS,
    messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
    response_format: { type: "json_schema", json_schema: { name: prompt.schemaName, strict: true, schema: prompt.schema } },
  }, signal) as { choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null }; finish_reason?: string }> };
  const choice = raw.choices?.[0];
  if (choice?.finish_reason === "length") throw new Error(TRUNCATED);
  return choice?.message?.content || choice?.message?.reasoning_content || "";
}

export function makeStructuredRequester(conn: DirectConnection): StructuredRequester {
  return (prompt, signal) => completeStructured(conn, prompt, signal);
}
