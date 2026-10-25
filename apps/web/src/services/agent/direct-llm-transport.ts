import { makeClientFromSend, withRetry, LLMHttpError, parseRetryAfterMs, type LLMClient } from "@openreel/agent";
import type { AIProvider } from "../../stores/ai-connection-store";

export interface DirectConnection { provider: AIProvider; baseUrl: string; model: string; apiKey: string; signal?: AbortSignal }
export function validateAIEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl.trim());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) throw new Error("Use an HTTPS base URL, or HTTP on localhost, without credentials, query parameters or fragments.");
  url.pathname = url.pathname.replace(/\/(?:chat\/completions|messages)\/?$/, "");
  return url.href.replace(/\/+$/, "");
}
export function makeDirectBYOKClient(options: DirectConnection): LLMClient {
  const baseUrl = validateAIEndpoint(options.baseUrl);
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname);
  if (!options.model.trim()) throw new Error("Enter a model ID that supports tools.");
  if (options.apiKey && /[\r\n]/.test(options.apiKey)) throw new Error("Invalid API key.");
  const provider = options.provider === "anthropic" ? "anthropic" : "openai";
  const send = withRetry(async (body: unknown) => {
    options.signal?.throwIfAborted();
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${provider === "anthropic" ? "/messages" : "/chat/completions"}`, { method: "POST", redirect: "error", credentials: "omit", headers: { "Content-Type": "application/json", ...(provider === "anthropic" ? { "x-api-key": options.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } : options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}) }, body: JSON.stringify(body), signal: options.signal });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new Error("The model endpoint could not be reached. Check its URL and browser CORS support. No proxy or security bypass is used.");
    }
    // Surface the endpoint's JSON error message; remote messages are redacted so a credential echo never reaches the UI.
    if (!res.ok) {
      let detail = "";
      try {
        const rawErr = await res.json() as Record<string, any>;
        if (typeof rawErr?.error === "string") {
          try {
            const inner = JSON.parse(rawErr.error);
            detail = inner?.error?.message || rawErr.error;
          } catch {
            detail = rawErr.error;
          }
        } else if (rawErr?.error?.message) {
          detail = [rawErr.error.type, rawErr.error.message].filter((part) => typeof part === "string").join(": ");
        }
      } catch {
        // ignore json parse error
      }
      if (detail && !isLocal) {
        if (options.apiKey) detail = detail.split(options.apiKey).join("[redacted]");
        detail = detail.replace(/\b(?:sk|key)[-_][A-Za-z0-9_*.-]{6,}/g, "[redacted]").slice(0, 300);
      }
      const safeMessage = detail
        ? `Model endpoint returned HTTP ${res.status}: ${detail}`
        : `Model endpoint returned HTTP ${res.status}. Check the key, model ID and provider settings.`;
      throw new LLMHttpError(safeMessage, res.status, parseRetryAfterMs(res.headers.get("retry-after")));
    }
    let raw: unknown;
    try { raw = await res.json(); } catch { throw new Error("The endpoint returned invalid JSON. Check the API adapter and endpoint."); }
    if (!raw || typeof raw !== "object" || (provider === "openai" && !("choices" in raw)) || (provider === "anthropic" && !("content" in raw))) throw new Error("The endpoint returned an unsupported response. Choose the correct API adapter and a tool-capable model.");
    return raw;
  }, { signal: options.signal, retries: 2 });
  return makeClientFromSend({ provider, model: options.model.trim(), ...(provider === "anthropic" ? {} : { maxTokens: 4096 }), send });
}
