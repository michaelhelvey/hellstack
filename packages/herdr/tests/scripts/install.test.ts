import { expect, test } from "bun:test";
import {
  lstat,
  lutimes,
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

/** Tells if `file` exists. A broken link exists. */
async function exists(file: string): Promise<boolean> {
  return lstat(file).then(
    () => true,
    () => false,
  );
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

test("linkConfig touches each mod link again, so that Herdr reloads the mod", async () => {
  await withFolders(async (config, app) => {
    const mod = path.join(app, "mods", "quiet");
    await linkConfig(app, config);
    const old = new Date(2020, 0, 1);
    await lutimes(mod, old, old);
    await linkConfig(app, config);
    expect((await lstat(mod)).mtime.getTime()).toBeGreaterThan(old.getTime());
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

test("linkConfig removes links to config files that do not exist", async () => {
  await withFolders(async (config, app) => {
    await linkConfig(app, config);
    await rm(path.join(config, "layouts", "main.json"));
    await rm(path.join(config, "mods", "quiet"), { recursive: true });
    await linkConfig(app, config);
    expect(await exists(path.join(app, "layouts", "main.json"))).toBe(false);
    expect(await exists(path.join(app, "mods", "quiet"))).toBe(false);
    expect(await readlink(path.join(app, "keys.json"))).toBe(path.join(config, "keys.json"));
  });
});

test("linkConfig keeps files, links out of the config folder, and Herdr folders", async () => {
  await withFolders(async (config, app) => {
    await mkdir(path.join(app, "layouts"), { recursive: true });
    const other = path.join(path.dirname(config), "config-old", "gone.json");
    await symlink(other, path.join(app, "layouts", "other.json"));
    await writeFile(path.join(app, "layouts", "mine.json"), "{}\n");
    await mkdir(path.join(app, "data"));
    const missing = path.join(config, "data", "gone.json");
    await symlink(missing, path.join(app, "data", "gone.json"));
    await linkConfig(app, config);
    expect(await readlink(path.join(app, "layouts", "other.json"))).toBe(other);
    expect(await readlink(path.join(app, "data", "gone.json"))).toBe(missing);
    expect(await readFile(path.join(app, "layouts", "mine.json"), "utf8")).toBe("{}\n");
  });
});

test("linkConfig does not write through an app folder that is a link", async () => {
  await withFolders(async (config, app) => {
    await symlink(config, app);
    const message = await linkConfig(app, config).catch((error: Error) => error.message);
    expect(message).toContain("is a link");
  });
});
