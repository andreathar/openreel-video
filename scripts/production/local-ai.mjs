// Local GPU helpers for prod.mjs: frame/thumbnail extraction with ffmpeg and
// calls to the local vision model (LM Studio or Ollama, OpenAI-compatible API).
// Jobs run one at a time on purpose: a 6 GB card holds one 4B VLM, not two.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export const LLM_URL = process.env.PROD_LLM_URL ?? "http://localhost:1235/v1";
export const VLM_MODEL = process.env.PROD_VLM_MODEL ?? "qwen3.5-4b";

/** Scales an image or one video frame to a small JPEG data URI. */
export async function jpegDataUri(file, { width = 512, at } = {}) {
  const args = ["-loglevel", "error", ...(at !== undefined ? ["-ss", String(at)] : []), "-i", file];
  args.push("-frames:v", "1", "-vf", `scale='min(${width},iw)':-2`, "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "-");
  const { stdout } = await run("ffmpeg", args, { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
  if (!stdout.length) throw new Error(`ffmpeg produced no frame for ${file}`);
  return `data:image/jpeg;base64,${stdout.toString("base64")}`;
}

export async function mediaDuration(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  const seconds = Number.parseFloat(stdout);
  if (!Number.isFinite(seconds)) throw new Error(`Cannot read duration of ${file}`);
  return seconds;
}

/** Evenly spaced frames, avoiding the very first and last frame. */
export async function sampleFrames(file, count = 6, width = 384) {
  const duration = await mediaDuration(file);
  const frames = [];
  for (let i = 0; i < count; i++) {
    const time = Math.min(duration - 0.05, ((i + 0.5) / count) * duration);
    frames.push({ time, dataUri: await jpegDataUri(file, { width, at: time }) });
  }
  return { duration, frames };
}

export async function chat(messages, { url = LLM_URL, model = VLM_MODEL, maxTokens = 600, temperature = 0.1, responseFormat } = {}) {
  const response = await fetch(`${url.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: false, ...(responseFormat ? { response_format: responseFormat } : {}) }),
  }).catch((error) => {
    throw new Error(`Local model not reachable at ${url} (${error.cause?.code ?? error.message}). Start LM Studio or set PROD_LLM_URL.`);
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    throw new Error(`Local model error ${response.status}: ${JSON.stringify(body.error ?? body).slice(0, 300)}`);
  }
  const choice = body.choices?.[0] ?? {};
  // Same wording as the web app, so convertDraft recognises it and falls back to rules for that chunk.
  if (choice.finish_reason === "length") {
    throw new Error(`The model ran out of output tokens (max_tokens ${maxTokens}). Try a shorter draft or a larger model.`);
  }
  const message = choice.message ?? {};
  return message.content || message.reasoning_content || "";
}

/** GPU memory in MiB, or null without nvidia-smi. */
export async function gpuMemory() {
  try {
    const { stdout } = await run("nvidia-smi", ["--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"]);
    const [used, total] = stdout.trim().split("\n")[0].split(",").map((v) => Number.parseInt(v, 10));
    return { used, total };
  } catch {
    return null;
  }
}
