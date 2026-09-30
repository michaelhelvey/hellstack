import net from "node:net";

/** The agent state that herdr shows for a pane. */
export type AgentState = "idle" | "working" | "blocked";

const source = "herdr:opencode";
let sequence = Date.now() * 1000;
let queue: Promise<void> = Promise.resolve();

/** Returns true when opencode runs in a herdr pane. */
export function herdrEnabled(): boolean {
  const env = process.env;
  return env["HERDR_ENV"] === "1" && Boolean(env["HERDR_SOCKET_PATH"] && env["HERDR_PANE_ID"]);
}

function makeRequest(method: string, params: Record<string, unknown>): string {
  sequence += 1;
  const nonce = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  const request = {
    id: `${source}:${Date.now()}:${nonce}`,
    method,
    params: {
      pane_id: process.env["HERDR_PANE_ID"],
      source,
      agent: "opencode",
      seq: sequence,
      ...params,
    },
  };
  return `${JSON.stringify(request)}\n`;
}

function send(line: string): Promise<void> {
  return new Promise((resolve) => {
    const client = net.createConnection(process.env["HERDR_SOCKET_PATH"] ?? "", () =>
      client.write(line),
    );
    function finish(): void {
      client.destroy();
      resolve();
    }
    client.setTimeout(500, finish);
    client.on("data", finish);
    client.on("error", finish);
    client.on("end", finish);
    client.on("close", resolve);
  });
}

/**
 * Sends one request to the herdr socket. Requests go one at a time, in the order of the calls. The
 * promise does not reject: when herdr does not reply in 500 ms, the request stops.
 */
export function herdrRequest(method: string, params: Record<string, unknown>): Promise<void> {
  const line = makeRequest(method, params);
  const pending = queue.then(() => send(line));
  queue = pending;
  return pending;
}
