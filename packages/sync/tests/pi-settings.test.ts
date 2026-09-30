import { expect, test } from "bun:test";

import { addPiPackage } from "../src/pi-settings.ts";

test("addPiPackage adds the package and keeps the other settings", () => {
  const text = JSON.stringify({ theme: "nightowl", packages: ["npm:foo", { source: "git:bar" }] });
  expect(JSON.parse(addPiPackage(text, "/repo/packages/pi"))).toEqual({
    theme: "nightowl",
    packages: ["npm:foo", { source: "git:bar" }, "/repo/packages/pi"],
  });
});

test("addPiPackage makes the packages list when it does not exist", () => {
  expect(JSON.parse(addPiPackage("{}", "/repo/packages/pi"))).toEqual({
    packages: ["/repo/packages/pi"],
  });
});

test("addPiPackage does not add the package a second time", () => {
  const once = addPiPackage("{}", "/repo/packages/pi");
  expect(addPiPackage(once, "/repo/packages/pi")).toBe(once);
  const asObject = JSON.stringify({ packages: [{ source: "/repo/packages/pi", skills: [] }] });
  expect(JSON.parse(addPiPackage(asObject, "/repo/packages/pi"))).toEqual({
    packages: [{ source: "/repo/packages/pi", skills: [] }],
  });
});

test("addPiPackage rejects a packages value that is not a list", () => {
  expect(() => addPiPackage('{ "packages": "npm:foo" }', "/repo/packages/pi")).toThrow();
});
