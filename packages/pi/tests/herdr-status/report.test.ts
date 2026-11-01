import { expect, test } from "bun:test";

import { clearReport, statusReport, statusText } from "../../src/herdr-status/index.ts";

test("statusReport writes a blocked dialog as an OSC 7501 report", () => {
  expect(statusReport({ state: "blocked", kind: "question", message: "Apply?" })).toBe(
    "\x1b]7501;state=blocked:app=pi:kind=question:msg=QXBwbHk/\x1b\\",
  );
});

test("statusReport leaves out a message that is empty after cleanup", () => {
  expect(statusReport({ state: "working", message: "\u0000\u0007 " })).toBe(
    "\x1b]7501;state=working:app=pi\x1b\\",
  );
});

test("statusText removes control characters and cuts at a UTF-8 byte boundary", () => {
  expect(statusText("a\u0007b\u001bc")).toBe("a b c");

  const cut = statusText("ééé", 5);
  expect(Buffer.byteLength(cut, "utf8")).toBeLessThanOrEqual(5);
  expect("ééé".startsWith(cut)).toBe(true);
});

test("clearReport removes every status record of pi", () => {
  expect(clearReport()).toBe("\x1b]7501;state=clear:app=pi\x1b\\");
});
