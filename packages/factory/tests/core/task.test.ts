import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { promptPath } from "../../src/core/paths.ts";
import {
  appendLogEntry,
  checkLandingItem,
  landingItems,
  landingProgress,
  newTask,
  newTaskId,
  parseTask,
  sectionText,
  serializeTask,
  UNTITLED_TITLE,
  validateHandoff,
  type Task,
} from "../../src/core/task.ts";
import { completeBody, tempFolder } from "./helpers.ts";

const fileText = `---
id: t-7f3a
title: Add the factory router
status: working
cwd: /Users/me/dev/hellstack
threads: [gh:helvey/hellstack#88]
paused: false
needs_you: null
now: waiting on review from @someone
created: 2026-11-05T14:00:00.000Z
updated: 2026-11-05T15:12:00.000Z
---
${completeBody}`;

async function template(): Promise<string> {
  return readFile(promptPath("task-template.md"), "utf8");
}

function withCwd(task: Task, cwd: string): Task {
  return { ...task, meta: { ...task.meta, cwd } };
}

describe("parseTask and serializeTask", () => {
  test("keep the front matter and the exact body", () => {
    const task = parseTask(fileText);
    expect(task.meta.threads).toEqual(["gh:helvey/hellstack#88"]);
    expect(task.meta.needs_you).toBeNull();
    expect(task.body).toBe(completeBody);
    expect(parseTask(serializeTask(task))).toEqual(task);
  });

  test("read an old file with repo as cwd, and write cwd", () => {
    const task = parseTask(fileText.replace("cwd:", "repo:"));
    expect(task.meta.cwd).toBe("/Users/me/dev/hellstack");
    const text = serializeTask(task);
    expect(text).toContain("\ncwd: /Users/me/dev/hellstack\n");
    expect(text).not.toContain("repo:");
  });

  test("give defaults to optional fields", () => {
    const text = fileText.replace(/threads:.*\npaused:.*\nneeds_you:.*\nnow:.*\n/, "");
    const { meta } = parseTask(text);
    expect(meta).toMatchObject({ threads: [], paused: false, needs_you: null, now: "" });
  });

  test("keep unknown fields, accept UTC offsets, and remove a byte order mark", () => {
    const text = `\ufeff${fileText.replace("paused: false", "paused: false\ntags: [a]")}`.replace(
      "2026-11-05T14:00:00.000Z",
      "2026-11-05T15:00:00+01:00",
    );
    const task = parseTask(text);
    expect(task.meta.created).toBe("2026-11-05T15:00:00+01:00");
    expect(parseTask(serializeTask(task)).meta.tags).toEqual(["a"]);
  });

  test("reject a file without front matter or with a bad field", () => {
    expect(() => parseTask("## Goal\n")).toThrow("no front matter");
    expect(() => parseTask(fileText.replace("status: working", "status: done"))).toThrow();
    expect(() => parseTask(fileText.replace("/Users/me/dev/hellstack", "relative"))).toThrow();
  });
});

describe("sections and landing", () => {
  test("sectionText ignores HTML comments", async () => {
    const body = `\n${await template()}`;
    expect(sectionText(body, "Goal")).toBe("");
    expect(sectionText(completeBody, "Notes")).toBe("Unknown sections stay.");
    expect(sectionText(completeBody, "Missing")).toBeUndefined();
  });

  test("landing items in comments do not count", async () => {
    expect(landingProgress(`\n${await template()}`)).toEqual({ done: 0, total: 0 });
    expect(landingProgress(completeBody)).toEqual({ done: 1, total: 2 });
    expect(landingItems(completeBody).map((item) => item.text)).toEqual(["PR opened", "merged"]);
  });

  test("code blocks do not make sections or landing items", () => {
    const body =
      "\n## Goal\n\n```md\n## Example\n- [ ] not an item\n```\n\n## Landing\n\n~~~\n- [ ] no\n~~~\n- [ ] yes\n";
    expect(sectionText(body, "Goal")).toBe("```md\n## Example\n- [ ] not an item\n```");
    expect(landingItems(body).map((item) => item.text)).toEqual(["yes"]);
  });

  test("checkLandingItem checks one item by its 1-based number", () => {
    const body = checkLandingItem(completeBody, 2);
    expect(landingProgress(body)).toEqual({ done: 2, total: 2 });
    expect(body).toContain("<!-- - [ ] an example in a comment -->");
    expect(() => checkLandingItem(completeBody, 3)).toThrow("no item 3");
  });
});

describe("appendLogEntry", () => {
  test("adds the entry after the last log item and keeps the rest", () => {
    const body = appendLogEntry(completeBody, "t worker: merged");
    expect(body).toBe(completeBody.replace("PR #88\n", "PR #88\n- t worker: merged\n"));
  });

  test("adds the first entry below the heading", async () => {
    const body = appendLogEntry(`\n${await template()}`, "t coordinator: made\nit");
    expect(body.endsWith("## Log\n\n- t coordinator: made it\n")).toBe(true);
  });

  test("keeps CRLF line ends", () => {
    const body = "\r\n## Log\r\n\r\n- a\r\n";
    expect(appendLogEntry(body, "b")).toBe("\r\n## Log\r\n\r\n- a\r\n- b\r\n");
    expect(appendLogEntry("\r\n## Goal\r\n", "b")).toBe("\r\n## Goal\r\n\r\n## Log\r\n\r\n- b\r\n");
  });

  test("adds a Log section when there is none", () => {
    expect(appendLogEntry("\n## Goal\n\nx\n", "t a: b")).toBe(
      "\n## Goal\n\nx\n\n## Log\n\n- t a: b\n",
    );
  });
});

describe("validateHandoff", () => {
  test("returns nothing for a complete task", async () => {
    const task = withCwd(parseTask(fileText), await tempFolder());
    expect(await validateHandoff(task)).toEqual([]);
  });

  test("refuses a task that is still untitled", async () => {
    const task = withCwd(parseTask(fileText), await tempFolder());
    const untitled = { ...task, meta: { ...task.meta, title: UNTITLED_TITLE } };
    expect(await validateHandoff(untitled)).toEqual(['the title is still "untitled"']);
  });

  test("returns each missing part of a new task", async () => {
    const now = new Date().toISOString();
    const task = newTask({
      id: newTaskId(),
      title: "x",
      cwd: "/no/such/folder",
      template: await template(),
      now,
    });
    expect(await validateHandoff(task)).toEqual([
      "Goal has no text",
      "Verification has no text",
      "Output has no text",
      "Constraints has no text",
      "Landing has no checkbox items",
      "cwd is not a folder: /no/such/folder",
    ]);
  });
});

test("newTaskId makes valid ids", () => {
  expect(newTaskId()).toMatch(/^t-[0-9a-f]{6}$/);
});
