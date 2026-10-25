import { afterEach, describe, expect, it, vi } from "vitest";
import { completeStructured, makeStructuredRequester } from "./structured-completion";

afterEach(() => { vi.unstubAllGlobals(); });
const prompt = { system: "sys", user: "usr", schema: { type: "object" }, schemaName: "script_labels" };
const bodyOf = (f: { mock: { calls: unknown[][] } }) => JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);

describe("completeStructured", () => {
  it("sends output_config.format to Anthropic and returns text blocks", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "thinking", thinking: "x" }, { type: "text", text: "{\"scenes\":[]}" }], stop_reason: "end_turn" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const out = await completeStructured({ provider: "anthropic", baseUrl: "http://localhost:5180/proxy/anthropic/v1", model: "m", apiKey: "k" }, prompt);
    expect(out).toBe("{\"scenes\":[]}");
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe("http://localhost:5180/proxy/anthropic/v1/messages");
    const body = bodyOf(fetch);
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.temperature).toBe(0);
    expect(body.response_format).toBeUndefined();
  });
  it("sends response_format json_schema to LM Studio", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const out = await makeStructuredRequester({ provider: "compatible", baseUrl: "http://localhost:1235/v1", model: "m", apiKey: "" })(prompt);
    expect(out).toBe("{}");
    const body = bodyOf(fetch);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.name).toBe("script_labels");
    expect(body.temperature).toBe(0);
  });
  it("reports truncation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: "{" }], stop_reason: "max_tokens" }), { status: 200 })));
    await expect(completeStructured({ provider: "anthropic", baseUrl: "https://example.com/v1", model: "m", apiKey: "k" }, prompt)).rejects.toThrow(/ran out of output tokens/);
  });
  it("keeps redacted HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { type: "authentication_error", message: "bad key sk-ant-api03-abcdef123" } }), { status: 401 })));
    const err = await completeStructured({ provider: "anthropic", baseUrl: "https://example.com/v1", model: "m", apiKey: "k" }, prompt).catch((e: Error) => e);
    expect(String(err)).toMatch(/HTTP 401/);
    expect(String(err)).not.toMatch(/sk-ant/);
  });
});
