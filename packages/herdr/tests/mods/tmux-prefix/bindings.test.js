import { describe, expect, test } from "bun:test";
import { actionFor, targetPane } from "../../../config/mods/tmux-prefix/bindings.js";
import { rememberPane } from "../../../config/mods/tmux-status/history.js";
import { rememberPane as rememberTabPane } from "../../../config/mods/herdr-tabs/geometry.js";

function event(key, key_char, modifiers = {}) {
  return { key, key_char, modifiers };
}

describe("prefix actions", () => {
  test("uses typed punctuation rather than the physical key", () => {
    expect(actionFor(event("5", "%", { shift: true }))).toEqual([
      "Split right",
      "pane.split",
      { direction: "right" },
    ]);
    expect(actionFor(event("'", '"', { shift: true }))).toEqual([
      "Split down",
      "pane.split",
      { direction: "down" },
    ]);
  });

  test("does not run a plain action for a modified shortcut", () => {
    expect(actionFor(event("c", "c", { control: true }))).toBeUndefined();
    expect(actionFor(event("c", "c", { platform: true }))).toBeUndefined();
    expect(actionFor(event("escape"))).toBeUndefined();
  });

  test("selects tab ten with zero and distinguishes spaces from panes", () => {
    expect(actionFor(event("0"))?.[2]).toEqual({ index: 10 });
    expect(actionFor(event("j", "J", { shift: true }))?.[1]).toBe("space.next");
    expect(actionFor(event("j", "j"))?.[1]).toBe("pane.go");
  });
});

describe.each([
  ["tmux", rememberPane],
  ["Herdr tabs", rememberTabPane],
])("%s pane history", (_name, rememberPane) => {
  const a = { tab: "one", pane: "a" };
  const b = { tab: "one", pane: "b" };
  const c = { tab: "two", pane: "c" };
  const panes = [a, b, c];

  test("tracks focus changes per tab and toggles back to the last pane", () => {
    let history = rememberPane({}, a);
    expect(rememberPane(history, a)).toBe(history);
    history = rememberPane(rememberPane(history, b), c);
    expect(targetPane("last-pane", panes, b, history)).toBe("a");
    history = rememberPane(history, a);
    expect(targetPane("last-pane", panes, a, history)).toBe("b");
    expect(targetPane("last-pane", panes, c, history)).toBeUndefined();
  });

  test("cycles only through the current tab and ignores closed history", () => {
    expect(targetPane("next-pane", panes, b, {})).toBe("a");
    expect(targetPane("next-pane", panes, c, {})).toBe("c");
    expect(targetPane("last-pane", [a], a, { one: ["a", "b"] })).toBeUndefined();
    expect(targetPane("next-pane", [], undefined, {})).toBeUndefined();
  });
});
