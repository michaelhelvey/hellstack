import { describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  checkoutCachePath,
  expandHome,
  findCheckout,
  remoteRepo,
} from "../../src/daemon/checkout.ts";
import { tempFolder, tempLedger } from "../core/helpers.ts";

async function checkout(folder: string, url: string): Promise<string> {
  await mkdir(join(folder, ".git"), { recursive: true });
  const config = `[core]\n\tbare = false\n[remote "upstream"]\n\turl = git@github.com:x/y.git\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`;
  await writeFile(join(folder, ".git", "config"), config);
  return folder;
}

describe("remoteRepo", () => {
  test("reads SSH and HTTPS GitHub URLs", () => {
    expect(remoteRepo("git@github.com:Acme/API.git")).toBe("acme/api");
    expect(remoteRepo("https://github.com/acme/api")).toBe("acme/api");
    expect(remoteRepo("https://gitlab.com/acme/api.git")).toBeUndefined();
  });

  test("expandHome replaces a leading ~", () => {
    expect(expandHome("~/dev")).toBe(join(homedir(), "dev"));
    expect(expandHome("/x/~")).toBe("/x/~");
  });
});

describe("findCheckout", () => {
  test("finds the checkout whose origin is the repository, down to 3 levels, and caches it", async () => {
    const root = await tempFolder();
    const paths = await tempLedger();
    await checkout(join(root, "a", "other"), "git@github.com:acme/web.git");
    const api = await checkout(join(root, "b", "c", "api"), "https://github.com/acme/api.git");
    await checkout(join(root, "b", "c", "d", "deep"), "git@github.com:acme/deep.git");

    expect(await findCheckout("Acme/API", ["/no/such/root", root], paths)).toBe(api);
    expect(await findCheckout("acme/deep", [root], paths)).toBeUndefined();
    const cache: unknown = JSON.parse(await readFile(checkoutCachePath(paths), "utf8"));
    expect(cache).toEqual({ "acme/api": api });
  });

  test("searches again when the cached checkout is gone", async () => {
    const root = await tempFolder();
    const paths = await tempLedger();
    const first = await checkout(join(root, "one"), "git@github.com:acme/api.git");
    expect(await findCheckout("acme/api", [root], paths)).toBe(first);
    await rm(first, { recursive: true });
    const second = await checkout(join(root, "two"), "git@github.com:acme/api.git");
    expect(await findCheckout("acme/api", [root], paths)).toBe(second);
  });
});
