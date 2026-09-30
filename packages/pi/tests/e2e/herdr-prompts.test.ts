import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { PiSandbox } from "./harness/sandbox.ts";

setDefaultTimeout(30_000);

let sandbox: PiSandbox;

let eventsFile: string;

afterEach(async () => {
  await sandbox.dispose();
  await rm(eventsFile, { force: true });
});

async function readEvents(file: string, count: number): Promise<unknown[]> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const text = (await Bun.file(file).exists()) ? await Bun.file(file).text() : "";
    const lines = text.split("\n").filter(Boolean);
    if (lines.length >= count) return lines.map((line) => JSON.parse(line) as unknown);
    await Bun.sleep(50);
  }
  throw new Error(`Expected ${count} herdr:blocked events in ${file}`);
}

test("a dialog sends herdr:blocked when it opens and when it closes", async () => {
  const probeFile = path.join(import.meta.dir, "fixtures", "herdr-probe.ts");
  eventsFile = path.join(tmpdir(), `herdr-events-${crypto.randomUUID()}.jsonl`);
  sandbox = await PiSandbox.create({
    extensions: [probeFile],
    env: { E2E_PROBE_FILE: eventsFile },
  });
  const pi = await sandbox.startRpc();
  pi.onDialog(() => ({ confirmed: true }));
  await pi.request({ type: "prompt", message: "/probe-confirm" });

  expect(await readEvents(eventsFile, 2)).toEqual([
    { active: true, label: "Probe dialog" },
    { active: false },
  ]);
});
