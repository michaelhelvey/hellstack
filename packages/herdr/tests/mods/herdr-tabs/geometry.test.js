import { expect, test } from "bun:test";
import { titlePadding } from "../../../config/mods/herdr-tabs/geometry.js";

const mac = { platform: "macos", titlebar: "none", fullscreen: false };

test("native window buttons keep the same title clearance when the app zoom changes", () => {
  for (const zoom of [0.5, 0.8, 1, 1.5, 3]) {
    const left = titlePadding(mac, zoom, [12, 16]) * zoom;
    expect(left).toBeGreaterThanOrEqual(12 + 64 + 8);
  }
});

test("off-window buttons do not leave an empty gap or negative padding", () => {
  for (const zoom of [0.5, 0.8, 1, 1.5, 3]) {
    expect(titlePadding(mac, zoom, [-100, 16])).toBe(14);
  }
});

test("moving the window buttons moves the reserved title space", () => {
  const original = titlePadding(mac, 0.8, [12, 16]);
  const moved = titlePadding(mac, 0.8, [32, 16]);
  expect((moved - original) * 0.8).toBe(20);
});

test("native title bars and fullscreen windows need no space inside the sidebar", () => {
  expect(titlePadding({ ...mac, fullscreen: true }, 0.8, [12, 16])).toBe(14);
  expect(titlePadding({ ...mac, titlebar: "system" }, 0.8, [12, 16])).toBe(14);
  expect(titlePadding({ ...mac, platform: "linux" }, 0.8, [12, 16])).toBe(14);
});
