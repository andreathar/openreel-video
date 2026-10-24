import {
  withRetry,
  makeClientFromSend,
  llmHttpError,
  parseRetryAfterMs,
} from "@openreel/agent";
import type { LLMClient, LLMSend } from "@openreel/agent";

export type LlmProvider = "anthropic" | "openai" | "openai-compatible";

const ENDPOINTS: Record<"anthropic" | "openai", string> = {
  anthropic: "https://api.anthropic.com/v1/messages",
  openai: "https://api.openai.com/v1/chat/completions",
};

function authHeaders(
  provider: LlmProvider,
  apiKey?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (provider === "anthropic") {
    headers["x-api-key"] = apiKey ?? "";
    headers["anthropic-version"] = "2023-06-01";
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

/**
 * Builds a fetch-based transport for the agent LLM clients. The API key is used
 * per-request for the Authorization header only and is never stored or logged —
 * preserving the BYOK no-persist guarantee on the server side.
 */
export function makeNodeLLMSend(
  provider: LlmProvider,
  apiKey?: string,
  fetchFn: typeof fetch = fetch,
  baseUrl?: string,
): LLMSend {
  if (!apiKey && provider !== "openai-compatible") {
    throw new Error(`Missing API key for provider '${provider}'`);
  }
  const endpoint =
    provider === "openai-compatible"
      ? `${(baseUrl || "http://localhost:1235/v1").replace(/\/+$/, "")}/chat/completions`
      : ENDPOINTS[provider];

  return async (body: unknown): Promise<unknown> => {
    const res = await fetchFn(endpoint, {
      method: "POST",
      headers: authHeaders(provider, apiKey),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw llmHttpError(
        provider === "anthropic" ? "anthropic" : "openai",
        res.status,
        text,
        parseRetryAfterMs(res.headers.get("retry-after")),
      );
    }
    return res.json();
  };
}

export interface NodeLLMOptions {
  readonly provider: LlmProvider;
  readonly model: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly maxTokens?: number;
  readonly fetchFn?: typeof fetch;
}

export function makeNodeLLMClient(opts: NodeLLMOptions): LLMClient {
  const send = withRetry(makeNodeLLMSend(opts.provider, opts.apiKey, opts.fetchFn, opts.baseUrl));
  return makeClientFromSend({
    provider: opts.provider === "anthropic" ? "anthropic" : "openai",
    model: opts.model,
    maxTokens: opts.maxTokens,
    send,
  });
}
