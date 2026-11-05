import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import { runCommand, type CommandRunner } from "./command.ts";

const spaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  folder: z.string().nullish(),
  tabs: z.array(z.object({ id: z.string(), name: z.string() })),
});
const lsSchema = z.object({ spaces: z.array(spaceSchema) });

/** A Herdr space and its tabs, as `herdr-app ls` shows them. */
export type HerdrSpace = z.infer<typeof spaceSchema>;

/** The value that tells that the Herdr window does not run. */
export const NO_WINDOW = "no window" as const;

/** A space or tab to give a name. */
export interface HerdrName {
  kind: "space" | "tab";
  id: string;
  name: string;
}

/**
 * Where a terminal goes in Herdr: the `herdr.space` and `herdr.tab` labels for `hc run`, and the
 * names to give after Herdr shows the terminal.
 */
export interface HerdrPlacement {
  labels: Record<string, string>;
  names: HerdrName[];
}

/** A thin client for the `herdr-app` CLI. */
export interface Herdr {
  /** Returns the spaces of the open window, or {@link NO_WINDOW}. */
  spaces(): Promise<HerdrSpace[] | typeof NO_WINDOW>;
  /** Renames a space or tab. Returns false when Herdr does not know it (yet) or fails. */
  rename(target: HerdrName): Promise<boolean>;
}

/** Returns a {@link Herdr} that runs the `herdr-app` CLI with `runner`. */
export function createHerdr(runner: CommandRunner = runCommand): Herdr {
  return {
    async spaces() {
      const result = await runner("herdr-app", ["ls"], 5_000);
      if (result.stderr.includes("no Herdr window")) return NO_WINDOW;
      if (result.code !== 0) throw new Error(`herdr-app ls failed: ${result.stderr.trim()}`);
      return lsSchema.parse(JSON.parse(result.stdout)).spaces;
    },
    async rename({ kind, id, name }) {
      const args = ["do", `${kind}.rename`, "--id", id, "--name", name];
      const result = await runner("herdr-app", args, 2_000).catch(() => undefined);
      return result?.code === 0;
    },
  };
}

async function realFolder(path: string): Promise<string> {
  return realpath(path).catch(() => path);
}

function shortHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/**
 * Returns the placement of the worker of task `id`: the space whose folder is `repo` (a new space
 * when there is none), in a tab of its own with the name `tabName`.
 */
export async function workerPlacement(
  spaces: HerdrSpace[],
  task: { id: string; repo: string; tabName: string },
): Promise<HerdrPlacement> {
  const folder = await realFolder(task.repo);
  const folders = await Promise.all(spaces.map((space) => realFolder(space.folder ?? "")));
  const space = spaces[folders.indexOf(folder)]?.id ?? `spfactory-${shortHash(folder)}`;
  const tab = `tbfactory-${task.id}`;
  return {
    labels: { "herdr.space": space, "herdr.tab": tab },
    names: [{ kind: "tab", id: tab, name: task.tabName }],
  };
}

/** Returns the placement of the coordinator: the space with the name `factory`. */
export function coordinatorPlacement(spaces: HerdrSpace[]): HerdrPlacement {
  const existing = spaces.find((space) => space.name === "factory")?.id;
  const space = existing ?? "spfactory";
  const names: HerdrName[] = [{ kind: "tab", id: "tbfactory", name: "coordinator" }];
  if (!existing) names.push({ kind: "space", id: space, name: "factory" });
  return { labels: { "herdr.space": space, "herdr.tab": "tbfactory" }, names };
}

/**
 * Gives each space and tab its name. Herdr shows a new terminal a short time after `hc run`, so
 * it tries again until Herdr knows the target. It stops trying after about `timeoutMs`.
 */
export async function applyNames(
  herdr: Herdr,
  names: HerdrName[],
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  await Promise.all(names.map((target) => renameWhenKnown(herdr, target, deadline)));
}

async function renameWhenKnown(herdr: Herdr, target: HerdrName, deadline: number): Promise<void> {
  while (!(await herdr.rename(target)) && Date.now() < deadline) await delay(250);
}
