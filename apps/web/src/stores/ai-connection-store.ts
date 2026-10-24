import { create } from "zustand";

export type AIProvider = "openai" | "anthropic" | "compatible";
export const AI_PROVIDER_DEFAULTS: Record<AIProvider, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5" },
  compatible: { baseUrl: "http://localhost:1235/v1", model: "qwen/qwen3.5-9b" },
};
interface AIConnectionState { provider: AIProvider; baseUrl: string; model: string; apiKey: string; configure: (options: Partial<Pick<AIConnectionState, "provider" | "baseUrl" | "model" | "apiKey">>) => void; forgetKey: () => void }
/** Intentionally no persistence: keys and connection details stay in this tab. */
export const useAIConnectionStore = create<AIConnectionState>((set) => ({ provider: "compatible", ...AI_PROVIDER_DEFAULTS.compatible, apiKey: "", configure: (options) => set(options), forgetKey: () => set({ apiKey: "" }) }));
