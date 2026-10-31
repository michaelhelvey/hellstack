/**
 * A stdio MCP server for the tests of the lazy server. It appends a line to the file in its first
 * argument when it starts, and answers `initialize`, `tools/list`, and `tools/call`.
 *
 * Usage: `bun fake-server.ts <start-log>`
 */
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

import { z } from "zod";

const RequestSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
});

const RESULTS: Record<string, unknown> = {
  initialize: {
    protocolVersion: "2025-06-18",
    capabilities: { tools: {} },
    serverInfo: { name: "fake", version: "1" },
  },
  "tools/list": { tools: [{ name: "echo", inputSchema: { type: "object" } }] },
  "tools/call": { content: [{ type: "text", text: "real answer" }] },
};

const startLog = process.argv[2];
if (startLog === undefined) throw new Error("Usage: fake-server.ts <start-log>");
appendFileSync(startLog, "started\n");

createInterface({ input: process.stdin }).on("line", (line) => {
  const request = RequestSchema.parse(JSON.parse(line));
  if (request.id === undefined) return;
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: RESULTS[request.method] })}\n`,
  );
});
