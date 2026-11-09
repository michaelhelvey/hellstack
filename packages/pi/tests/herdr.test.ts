import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { realpathSync } from "node:fs";
import { chmod, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { FAKE_MODEL, FakeModel, type FakeRequest } from "./fake-model.ts";
import { PiSandbox } from "./pi.ts";

setDefaultTimeout(90_000);

const CHILD_PROVIDER = "fake-child";

/** Logs its arguments. `ls` gives no spaces. `space.new` starts a shell as the stray terminal. */
const FAKE_HERDR_APP = `#!/bin/sh
echo "$@" >> "$FAKE_APP_LOG"
if [ -n "$FAKE_APP_DOWN" ]; then echo '{"error":"no window"}'; exit 1; fi
case "$1" in
  ls) echo '{"spaces":[]}' ;;
  do) t=$(hc run --bg --json sh | sed -n 's/.*"address":"\\([^"]*\\)".*/\\1/p')
      printf '{"space":"sp-test","tab":"tb-test","terminal":"%s"}\\n' "$t" ;;
esac
`;

const TerminalSchema = z.looseObject({
  address: z.string(),
  state: z.string(),
  labels: z.record(z.string(), z.string()).default({}),
});

let sandbox: PiSandbox;
let childModel: FakeModel;
let hcEnv: Record<string, string>;
let socket: string;
let cores = 0;

const hc = async (command: string, ...args: Array<string>): Promise<unknown> => {
  const proc = Bun.spawn(["hc", command, "--json", ...args], { env: hcEnv, stdout: "pipe" });
  return JSON.parse(await new Response(proc.stdout).text());
};

const terminal = async (address: string) => TerminalSchema.parse(await hc("get", address));

/** Calls `find` every 100 ms until it gives a value, for at most 30 seconds. */
const waitUntil = async <A>(
  what: string,
  find: () => A | undefined | Promise<A | undefined>,
  tries = 300,
): Promise<A> => {
  const found = await find();
  if (found !== undefined) return found;
  if (tries === 0) throw new Error(`timed out waiting for ${what}`);
  await Bun.sleep(100);
  return waitUntil(what, find, tries - 1);
};

const requestWith = (model: FakeModel, text: string) =>
  waitUntil(`a request with "${text}"`, () =>
    model.requests.find((request) => JSON.stringify(request.messages).includes(text)),
  );

const toolNames = (request: FakeRequest) =>
  z
    .array(z.object({ function: z.object({ name: z.string() }) }))
    .parse(request.tools)
    .map((tool) => tool.function.name);

beforeEach(async () => {
  sandbox = await PiSandbox.create({ defaultProjectTrust: "always" });
  childModel = new FakeModel();
  await sandbox.write(
    ".pi/agent/models.json",
    JSON.stringify({
      providers: { fake: sandbox.model.provider, [CHILD_PROVIDER]: childModel.provider },
    }),
  );
  await sandbox.write("herdr-app", FAKE_HERDR_APP);
  await chmod(path.join(sandbox.root, "herdr-app"), 0o755);
  // The default socket path in the sandbox home is longer than macOS allows.
  socket = `/tmp/hst-${process.pid}-${cores++}.sock`;
  await sandbox.write(".config/herdr-core/config.toml", `socket = "${socket}"\n`);
  hcEnv = {
    PATH: process.env.PATH ?? "",
    HOME: sandbox.root,
    HC_SESSION: "test",
    HERDR_APP_BIN: path.join(sandbox.root, "herdr-app"),
    FAKE_APP_LOG: path.join(sandbox.root, "herdr-app.log"),
  };
});

afterEach(async () => {
  await hc("server", "stop");
  await rm(socket, { force: true });
  await childModel.stop();
  await sandbox.dispose();
});

/** Starts a shell in hc as the terminal of the parent pi, and pi in RPC mode as the parent. */
const startParent = async (env: Record<string, string> = {}) => {
  const shell = TerminalSchema.parse(await hc("run", "--bg", "sh"));
  const pi = sandbox.rpc({ ...hcEnv, HC_TERMINAL_ID: shell.address, ...env });
  return { address: shell.address, pi };
};

const spawnHelper = async (pi: ReturnType<PiSandbox["rpc"]>) => {
  sandbox.model.callTools({
    name: "agent_spawn",
    arguments: {
      name: "helper",
      task: "Count the bugs.",
      model: `${CHILD_PROVIDER}/${FAKE_MODEL}`,
    },
  });
  const [result] = await pi.prompt("start a helper");
  if (!result) throw new Error("agent_spawn did not run");
  const address = z.string().parse(/\((t\w+)\)/.exec(result.text)?.[1]);
  return { ...result, address };
};

test("a subagent reports to its parent, and its exit is news for the parent", async () => {
  const parent = await startParent();
  childModel.callTools({ name: "report", arguments: { status: "done", summary: "found 2 bugs" } });

  const { isError, address } = await spawnHelper(parent.pi);
  expect(isError).toBe(false);

  const childRequest = await requestWith(childModel, "Count the bugs.");
  expect(toolNames(childRequest)).toContain("report");
  expect(toolNames(childRequest)).not.toContain("agent_spawn");

  const reported = await requestWith(sandbox.model, "found 2 bugs");
  expect(JSON.stringify(reported.messages)).toContain(
    `<subagent name=\\"helper\\" address=\\"${address}\\" event=\\"done\\">`,
  );

  await hc("kill", address);
  await requestWith(sandbox.model, `event=\\"exited\\"`);
});

test("shows the parent and the subagent in a new herdr-app space, in place of its shell", async () => {
  const parent = await startParent();

  const { text, address } = await spawnHelper(parent.pi);

  expect(text).toContain("It shows in the herdr-app window.");
  expect((await terminal(address)).labels).toMatchObject({
    "herdr.space": "sp-test",
    "hellstack.parent": parent.address,
    "hellstack.name": "helper",
  });
  expect((await terminal(parent.address)).labels).toMatchObject({
    "herdr.space": "sp-test",
    "herdr.tab": "tb-test",
  });
  const log = await Bun.file(path.join(sandbox.root, "herdr-app.log")).text();
  expect(log).toContain(`do space.new --name work --folder ${realpathSync(sandbox.workDir)}`);
  const live = z.object({ terminals: z.array(TerminalSchema) }).parse(await hc("ls"));
  expect(live.terminals.map((t) => t.address).toSorted()).toEqual(
    [parent.address, address].toSorted(),
  );
});

test("shows a top agent with hellstack.show=1 in herdr-app before it starts a subagent", async () => {
  const shell = TerminalSchema.parse(await hc("run", "--bg", "--label", "hellstack.show=1", "sh"));
  sandbox.rpc({ ...hcEnv, HC_TERMINAL_ID: shell.address });

  const labels = await waitUntil("the herdr.space label", async () => {
    const current = (await terminal(shell.address)).labels;
    return current["herdr.space"] ? current : undefined;
  });

  expect(labels).toMatchObject({ "herdr.space": "sp-test", "herdr.tab": "tb-test" });
});

test("starts the subagent hidden when the herdr-app window does not run", async () => {
  const parent = await startParent({ FAKE_APP_DOWN: "1" });

  const { isError, text, address } = await spawnHelper(parent.pi);

  expect(isError).toBe(false);
  expect(text).not.toContain("herdr-app window");
  expect((await terminal(address)).labels["herdr.space"]).toBeUndefined();
});

test("fails when pi does not run in an hc terminal", async () => {
  const pi = sandbox.rpc(hcEnv);
  sandbox.model.callTools({ name: "agent_spawn", arguments: { name: "helper", task: "x" } });

  const [result] = await pi.prompt("start a helper");

  expect(result?.isError).toBe(true);
  expect(result?.text).toContain("$HC_TERMINAL_ID is not set");
});
