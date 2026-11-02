import { expect, test } from "bun:test";

import type {
  AssistantMessage,
  Message,
  SystemMessage,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "@earendil-works/pi-ai";

import { formatTokens, renderContextText } from "../../src/context/render.ts";
import { buildContextReport } from "../../src/context/report.ts";

const USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function user(text: string): UserMessage {
  return { role: "user", content: text, timestamp: 0 };
}

function assistant(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "fake",
    model: "fake-model",
    usage: USAGE,
    stopReason: "stop",
    timestamp: 0,
  };
}

function toolResult(toolName: string, toolCallId: string, text: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 0,
  };
}

function projectSection(): string {
  return [
    '<project_instructions path="/repo/AGENTS.md">',
    "project rules ".repeat(40),
    "</project_instructions>",
    '<project_instructions path="/repo/packages/pi/AGENTS.md">',
    "package rules ".repeat(20),
    "</project_instructions>",
  ].join("\n");
}

function skillsSection(): string {
  return [
    "<available_skills>",
    "<skill>",
    "<name>deploy</name>",
    "<description>Deploy the app.</description>",
    "<location>/skills/deploy/SKILL.md</location>",
    "</skill>",
    "</available_skills>",
  ].join("\n");
}

function tools(): NonNullable<SystemMessage["toolsAdded"]> {
  const parameters = { type: "object", properties: {} };

  return [
    { name: "read", description: "Read a file.", parameters },
    { name: "bash", description: "Run a command.", parameters },
  ];
}

function system(): SystemMessage {
  return {
    role: "system",
    content: "",
    sections: {
      preamble: "base prompt ".repeat(40),
      project_context: projectSection(),
      skills: skillsSection(),
    },
    toolsAdded: tools(),
    timestamp: 0,
  };
}

function messages(): Message[] {
  return [
    user("make the test pass"),
    assistant([
      { type: "text", text: "I will read the file." },
      { type: "toolCall", id: "call-1", name: "read", arguments: { path: "src/foo.ts" } },
    ]),
    toolResult("read", "call-1", "const answer = 42;\n".repeat(100)),
  ];
}

function sampleReport() {
  return buildContextReport({
    model: "fake-model",
    contextWindow: 4000,
    totalTokens: 1000,
    percent: null,
    system: system(),
    systemPromptFallback: "",
    messages: messages(),
  });
}

test("the report names the sources of the system prompt, the tools, and the conversation", () => {
  const report = sampleReport();

  expect(report.totalTokens).toBe(1000);
  expect(report.percent).toBe(25);
  expect(report.sections.map((section) => section.title)).toEqual([
    "System prompt",
    "Tool definitions",
    "Conversation",
  ]);

  const prompt = report.sections[0];
  const agents = prompt?.parts.find((part) => part.label === "AGENTS.md");
  expect(agents?.detail).toBe("/repo/AGENTS.md");
  expect(agents?.tokens).toBeGreaterThan(0);
  expect(prompt?.parts.some((part) => part.label === "skill: deploy")).toBe(true);

  expect(report.sections[1]?.parts.map((part) => part.label)).toEqual(["read", "bash"]);
  const toolResultPart = report.sections[2]?.parts.find(
    (part) => part.label === "tool result: read",
  );
  expect(toolResultPart?.count).toBe(1);
  expect(toolResultPart?.tokens).toBeGreaterThan(0);
  expect(report.largest[0]?.label).toContain("tool result: read src/foo.ts");
});

test("an unknown total falls back to the sum of the estimated parts", () => {
  const report = buildContextReport({
    contextWindow: 0,
    totalTokens: null,
    percent: null,
    system: undefined,
    systemPromptFallback: "system prompt ".repeat(20),
    messages: [user("hello")],
  });
  const sum = report.sections.reduce((total, section) => total + section.tokens, 0);

  expect(report.totalTokens).toBe(sum);
  expect(report.percent).toBeNull();
});

test("formatTokens uses one decimal below ten thousand tokens and whole thousands above", () => {
  expect([0, 999, 1000, 1500, 10_000, 999_000, 1_000_000].map(formatTokens)).toEqual([
    "0",
    "999",
    "1.0k",
    "1.5k",
    "10k",
    "999k",
    "1.0M",
  ]);
});

test("the plain text report shows the sections and the largest messages", () => {
  const text = renderContextText(sampleReport()).join("\n");

  expect(text).toContain("Context · 1.0k / 4.0k (25.0%)");
  expect(text).toContain("System prompt");
  expect(text).toContain("AGENTS.md · /repo/packages/pi/AGENTS.md");
  expect(text).toContain("skill: deploy");
  expect(text).toContain("Largest items");
});
