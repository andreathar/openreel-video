import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

// Runs the real CLI (scripts/production/prod.mjs) so its manifest merge is checked end to end.
const run = promisify(execFile);
const PROD = resolve(__dirname, "../../../../scripts/production/prod.mjs");

const SCRIPT = `Title: The Heist

INT. VAULT - NIGHT

Mara drops onto the marble floor.

MARA
Three minutes.
`;

let dir = "";
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = "";
});

describe("prod init", () => {
  it("stores the Fountain as the production script and replaces a stale one on re-init", async () => {
    dir = await mkdtemp(join(tmpdir(), "prod-init-"));
    const file = join(dir, "film.fountain");
    const folder = join(dir, "prod");
    await writeFile(file, SCRIPT);
    await run(process.execPath, [PROD, "init", folder, file, "--code", "HST"]);
    const first = JSON.parse(await readFile(join(folder, "production.json"), "utf8"));
    expect(first.script).toBe(SCRIPT);

    const revised = SCRIPT.replace("Three minutes", "Two minutes");
    await writeFile(file, revised);
    await run(process.execPath, [PROD, "init", folder, file, "--code", "HST"]);
    const second = JSON.parse(await readFile(join(folder, "production.json"), "utf8"));
    expect(second.script).toBe(revised);
  }, 30_000);
});
