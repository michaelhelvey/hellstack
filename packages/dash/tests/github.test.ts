import { expect, test } from "bun:test";
import { webUrl } from "../src/github.ts";

const REPO = "https://github.com/o/r";

test.each([
  ["https://api.github.com/repos/o/r/pulls/51", "https://github.com/o/r/pull/51"],
  ["https://api.github.com/repos/o/r/issues/7", "https://github.com/o/r/issues/7"],
  ["https://api.github.com/repos/o/r/commits/abc123", "https://github.com/o/r/commit/abc123"],
  ["https://api.github.com/repos/o/r/releases/99", REPO],
  ["https://api.github.com/repos/o/r/pulls/51/comments", REPO],
  [null, REPO],
])("webUrl(%p) is %p", (subjectUrl, expected) => {
  expect(webUrl(subjectUrl, REPO)).toBe(expected);
});
