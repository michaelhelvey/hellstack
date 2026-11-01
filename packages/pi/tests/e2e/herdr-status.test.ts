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

function probeFile(): string {
  return path.join(import.meta.dir, "fixtures", "herdr-probe.ts");
}

test("a dialog sends herdr:blocked when it opens and when it closes", async () => {
  eventsFile = path.join(tmpdir(), `herdr-events-${crypto.randomUUID()}.jsonl`);
  sandbox = await PiSandbox.create({
    extensions: [probeFile()],
    env: { E2E_PROBE_FILE: eventsFile, HC_TERMINAL_ID: "t1" },
  });
  const pi = await sandbox.startRpc();
  pi.onDialog(() => ({ confirmed: true }));
  await pi.request({ type: "prompt", message: "/probe-confirm" });

  expect(await readEvents(eventsFile, 2)).toEqual([
    { active: true, label: "Probe dialog" },
    { active: false },
  ]);
});

test("a dialog reports blocked and idle to herdr-core through OSC 7501", async () => {
  eventsFile = path.join(tmpdir(), `herdr-events-${crypto.randomUUID()}.jsonl`);
  sandbox = await PiSandbox.create({
    extensions: [probeFile()],
    env: { E2E_PROBE_FILE: eventsFile, HC_TERMINAL_ID: "t1" },
  });
  const pi = sandbox.startTui();
  await pi.waitForRaw("\x1b]7501;state=idle:app=pi\x1b\\");
  await pi.submit("/probe-confirm");
  await pi.waitForRaw("state=blocked:app=pi:kind=permission:msg=UHJvYmUgZGlhbG9n");

  const mark = pi.rawOutput.length;
  pi.type("\r");
  await pi.waitForRaw("state=idle:app=pi", mark);
});

test("a run reports working and done to herdr-core through OSC 7501", async () => {
  eventsFile = path.join(tmpdir(), `herdr-events-${crypto.randomUUID()}.jsonl`);
  sandbox = await PiSandbox.create({ env: { HC_TERMINAL_ID: "t1" } });
  sandbox.model.reply({ text: "Done.", delayMs: 500 });
  const pi = sandbox.startTui();
  await pi.waitForRaw("\x1b]7501;state=idle:app=pi\x1b\\");
  await pi.submit("hello");
  await pi.waitForRaw("state=working:app=pi");
  await pi.waitForRaw("state=done:app=pi");
});
