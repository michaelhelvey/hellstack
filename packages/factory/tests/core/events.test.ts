import { expect, test } from "bun:test";

import { githubThread, sentryThread, taskThread, threadRepo } from "../../src/core/events.ts";

test("threadRepo returns the repository of GitHub thread keys only", () => {
  expect(threadRepo(githubThread("helvey", "hellstack", 88))).toBe("helvey/hellstack");
  expect(threadRepo(sentryThread("acme", "API-12"))).toBeUndefined();
  expect(threadRepo(taskThread("t-7f3a"))).toBeUndefined();
});
