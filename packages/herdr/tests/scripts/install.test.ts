import { expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { linkConfig } from "../../scripts/install.ts";

/** Runs `run` with a small config folder and an empty app folder in a temporary folder. */
async function withFolders(run: (config: string, app: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "hellstack-herdr-"));
  const config = path.join(root, "config");
  await mkdir(path.join(config, "layouts"), { recursive: true });
  await mkdir(path.join(config, "mods", "quiet"), { recursive: true });
  await writeFile(path.join(config, "keys.json"), "{}\n");
  await writeFile(path.join(config, "layouts", "main.json"), "{}\n");
  await writeFile(path.join(config, "mods", "quiet", "mod.json"), "{}\n");
  try {
    await run(config, path.join(root, "app"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("linkConfig links files and mod folders, and makes the other folders", async () => {
  await withFolders(async (config, app) => {
    await linkConfig(app, config);
    expect(await readlink(path.join(app, "keys.json"))).toBe(path.join(config, "keys.json"));
    expect((await lstat(path.join(app, "layouts"))).isSymbolicLink()).toBe(false);
    expect(await readlink(path.join(app, "layouts", "main.json"))).toBe(
      path.join(config, "layouts", "main.json"),
    );
    expect(await readlink(path.join(app, "mods", "quiet"))).toBe(
      path.join(config, "mods", "quiet"),
    );
  });
});

test("linkConfig keeps a file that Herdr wrote over a link as a backup", async () => {
  await withFolders(async (config, app) => {
    await mkdir(app);
    await writeFile(path.join(app, "keys.json"), "mine\n");
    await linkConfig(app, config);
    await linkConfig(app, config);
    expect(await readFile(path.join(app, "keys.json.bak"), "utf8")).toBe("mine\n");
    expect(await readlink(path.join(app, "keys.json"))).toBe(path.join(config, "keys.json"));
  });
});

test("linkConfig does not write through an app folder that is a link", async () => {
  await withFolders(async (config, app) => {
    await symlink(config, app);
    expect(linkConfig(app, config)).rejects.toThrow("is a link");
  });
});
