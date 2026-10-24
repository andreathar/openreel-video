#!/usr/bin/env node
import process from "node:process";
import { runHeadlessEditFile } from "./run";
import type { LlmProvider } from "./node-llm";

interface CliArgs {
  project?: string;
  prompt?: string;
  provider: LlmProvider;
  model?: string;
  baseUrl?: string;
  out?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { provider: "anthropic", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => argv[++i] ?? "";
    switch (arg) {
      case "--project":
      case "-p":
        args.project = next();
        break;
      case "--prompt":
      case "-m":
        args.prompt = next();
        break;
      case "--provider": {
        const val = next().toLowerCase();
        args.provider =
          val === "openai"
            ? "openai"
            : val === "openai-compatible" || val === "compatible" || val === "local"
              ? "openai-compatible"
              : "anthropic";
        break;
      }
      case "--model":
        args.model = next();
        break;
      case "--base-url":
      case "-u":
        args.baseUrl = next();
        break;
      case "--out":
      case "-o":
        args.out = next();
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        break;
    }
  }
  return args;
}

function resolveApiKey(provider: LlmProvider): string {
  return (
    process.env.OPENREEL_API_KEY ??
    (provider === "anthropic"
      ? process.env.ANTHROPIC_API_KEY
      : process.env.OPENAI_API_KEY) ??
    ""
  );
}

const DEFAULT_MODEL: Record<LlmProvider, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-5.6-sol",
  "openai-compatible": "qwen/qwen3.5-9b",
};

const USAGE = `openreel-agent — headless project editing

Usage:
  openreel-agent --project <file.json> --prompt "<instruction>" [options]

Options:
  -p, --project  <path>   Project JSON to edit (required)
  -m, --prompt   <text>   Natural-language editing instruction (required)
      --provider <name>   anthropic | openai | openai-compatible (default: anthropic)
      --model    <id>     Model id (default: provider default)
  -u, --base-url <url>    Base URL for openai-compatible (default: http://localhost:1235/v1)
  -o, --out      <path>   Output path (default: edit in place)
      --dry-run           Plan without applying mutations

API key (optional for local/openai-compatible): OPENREEL_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY.`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || !args.prompt) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(args.project || args.prompt ? 1 : 0);
  }
  const apiKey = resolveApiKey(args.provider);
  if (!apiKey && args.provider !== "openai-compatible") {
    process.stderr.write(
      `No API key found. Set OPENREEL_API_KEY (or ${args.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"}).\n`,
    );
    process.exit(1);
  }

  const model = args.model ?? DEFAULT_MODEL[args.provider];
  const baseUrl = args.baseUrl ?? process.env.LOCAL_LLM_URL ?? process.env.OPENAI_BASE_URL ?? "http://localhost:1235/v1";
  try {
    const { result, saved } = await runHeadlessEditFile({
      projectPath: args.project,
      prompt: args.prompt,
      provider: args.provider,
      model,
      apiKey,
      baseUrl,
      outPath: args.out,
      dryRun: args.dryRun,
    });
    const usage = `${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens`;
    process.stdout.write(
      `Done (${result.stoppedReason}). ${result.toolCalls} tool call(s), ${usage}.\n` +
        (saved
          ? `Saved to ${args.out ?? args.project}.\n`
          : `Not saved${args.dryRun ? " (dry-run)" : result.stoppedReason === "error" ? " (turn errored)" : ""}.\n`),
    );
    process.exit(result.stoppedReason === "error" ? 1 : 0);
  } catch (error) {
    process.stderr.write(
      `Headless run failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}
