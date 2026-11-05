import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The paths of the files and folders in one ledger. */
export interface LedgerPaths {
  /** The ledger folder. */
  home: string;
  /** The machine config. */
  config: string;
  /** The coordinator's memory. */
  coordinator: string;
  /** The folder of task files. */
  tasks: string;
  /** The folder of inbox events. */
  inbox: string;
  /** The append-only feed. */
  feed: string;
  /** The folder of daemon state. */
  state: string;
}

/** Returns the ledger folder: `FACTORY_HOME`, or `~/.factory` when it is not set. */
export function factoryHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.FACTORY_HOME || join(homedir(), ".factory");
}

/** Returns the paths of the ledger in `home`. The default is {@link factoryHome}. */
export function ledgerPaths(home: string = factoryHome()): LedgerPaths {
  return {
    home,
    config: join(home, "config.json"),
    coordinator: join(home, "COORDINATOR.md"),
    tasks: join(home, "tasks"),
    inbox: join(home, "inbox"),
    feed: join(home, "feed.jsonl"),
    state: join(home, "state"),
  };
}

/** Returns the path of the file of task `id`. */
export function taskPath(paths: LedgerPaths, id: string): string {
  return join(paths.tasks, `${id}.md`);
}

/** Returns the path of the inbox file of event `id`. */
export function inboxPath(paths: LedgerPaths, id: string): string {
  return join(paths.inbox, `${id}.json`);
}

/** Returns the path of a file in the `prompts` folder of this package. */
export function promptPath(name: string): string {
  return fileURLToPath(new URL(`../../prompts/${name}`, import.meta.url));
}
