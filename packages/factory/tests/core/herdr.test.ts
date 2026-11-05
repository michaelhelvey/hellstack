import { describe, expect, test } from "bun:test";

import {
  applyNames,
  coordinatorPlacement,
  createHerdr,
  NO_WINDOW,
  workerPlacement,
  type Herdr,
  type HerdrName,
  type HerdrSpace,
} from "../../src/core/herdr.ts";
import { tempFolder } from "./helpers.ts";

function space(id: string, name: string, folder: string): HerdrSpace {
  return { id, name, folder, tabs: [] };
}

describe("createHerdr", () => {
  test("spaces returns NO_WINDOW when the window does not run", async () => {
    const herdr = createHerdr(() =>
      Promise.resolve({ code: 2, stdout: "", stderr: "herdr-app: no Herdr window at /x.sock" }),
    );
    expect(await herdr.spaces()).toBe(NO_WINDOW);
  });
});

describe("workerPlacement", () => {
  test("uses the space of the repo folder and a tab of the task", async () => {
    const repo = await tempFolder();
    const spaces = [space("sp1", "other", "/elsewhere"), space("sp2", "repo", repo)];
    const placement = await workerPlacement(spaces, { id: "t-7f3a", repo, tabName: "t-7f3a x" });
    expect(placement).toEqual({
      labels: { "herdr.space": "sp2", "herdr.tab": "tbfactory-t-7f3a" },
      names: [{ kind: "tab", id: "tbfactory-t-7f3a", name: "t-7f3a x" }],
    });
  });

  test("makes the same new space id for the same repo", async () => {
    const repo = await tempFolder();
    const first = await workerPlacement([], { id: "t-0001", repo, tabName: "a" });
    const second = await workerPlacement([], { id: "t-0002", repo, tabName: "b" });
    expect(first.labels["herdr.space"]).toMatch(/^spfactory-[0-9a-f]{12}$/);
    expect(second.labels["herdr.space"]).toBe(first.labels["herdr.space"]);
  });
});

describe("coordinatorPlacement", () => {
  test("uses the factory space or names a new one", () => {
    expect(coordinatorPlacement([space("sp9", "factory", "/f")]).labels["herdr.space"]).toBe("sp9");
    expect(coordinatorPlacement([]).names).toContainEqual({
      kind: "space",
      id: "spfactory",
      name: "factory",
    });
  });
});

test("applyNames tries again until Herdr knows the target", async () => {
  const tries: string[] = [];
  const herdr: Herdr = {
    spaces: () => Promise.resolve([]),
    rename: (target: HerdrName) => {
      tries.push(target.id);
      return Promise.resolve(tries.length >= 2);
    },
  };
  await applyNames(herdr, [
    { kind: "tab", id: "a", name: "A" },
    { kind: "space", id: "b", name: "B" },
  ]);
  expect(tries).toEqual(["a", "a", "b"]);
});
