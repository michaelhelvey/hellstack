import { z } from "zod";

import { chooseSplit, MAX_AGENTS_PER_TAB, type PaneRect, tabLabel } from "../layout.ts";
import type { RexClient } from "./client.ts";

/** The part of the Rex client that the provider uses. Tests give a fake. */
export type RexApi = Pick<RexClient, "call" | "subscribe">;

/** A Rex block for a new subagent. */
export interface Placement {
  windowId: string;
  blockId: string;
  /** The label of the window, for example `hellstack-review-1`. */
  label: string;
}

/** The program to start in a new block, and the label of the block. */
export interface BlockSpec {
  label: string;
  cwd: string;
  command: string[];
}

/** The data that `TabPlanner` uses to make windows and blocks. */
export interface TabPlannerOptions {
  client: RexApi;
  /** The name of the project, for example the base name of the working folder. */
  project: string;
}

interface OwnTab {
  label: string;
  group: string;
  blocks: Set<string>;
}

/** The flavor of a Rex terminal block. */
const TERMINAL_FLAVOR = "com.superlogical.terminal.shell";

const ViewSchema = z.object({ windows: z.array(z.object({ label: z.string() })) });

const WindowCreatedSchema = z.object({ window_id: z.string(), block_ids: z.array(z.string()) });

const SplitCreatedSchema = z.object({ block_ids: z.array(z.string()) });

const SizeSchema = z.object({ columns: z.number(), rows: z.number() });

const DIRECTIONS = { right: "horizontal", down: "vertical" } as const;

function blockLayout(block: BlockSpec): object {
  const options = { command: block.command, cwd: block.cwd };

  return { block: { flavor: TERMINAL_FLAVOR, label: block.label, options } };
}

/**
 * Finds a block for each new subagent. It keeps the windows that it made in memory. It puts a new
 * subagent in a window of the same group that has fewer than `MAX_AGENTS_PER_TAB` subagents, or
 * it makes a new window. Callers must not call `place` again before the last call is complete.
 */
export class TabPlanner {
  readonly #options: TabPlannerOptions;
  readonly #tabs = new Map<string, OwnTab>();

  constructor(options: TabPlannerOptions) {
    this.#options = options;
  }

  /** Starts the program in a new block for a subagent of the group. */
  async place(group: string, block: BlockSpec): Promise<Placement> {
    const tab = [...this.#tabs.entries()].find(
      ([, own]) => own.group === group && own.blocks.size < MAX_AGENTS_PER_TAB,
    );

    const placement = tab
      ? await this.#split(tab[0], tab[1], block)
      : await this.#create(group, block);
    this.#tabs.get(placement.windowId)?.blocks.add(placement.blockId);

    return placement;
  }

  /** Removes a block. Rex closes a window when its last block closes. */
  release(blockId: string): void {
    for (const [windowId, own] of this.#tabs) {
      own.blocks.delete(blockId);

      if (own.blocks.size === 0) this.#tabs.delete(windowId);
    }
  }

  /** Forgets a window that Rex closed. */
  forgetTab(windowId: string): void {
    this.#tabs.delete(windowId);
  }

  async #create(group: string, block: BlockSpec): Promise<Placement> {
    const { client, project } = this.#options;
    const { windows } = await client.call("session.view", {}, ViewSchema);
    const label = tabLabel(project, group, new Set(windows.map((window) => window.label)));
    const params = { window_label: label, layout: blockLayout(block), focus: false };
    const created = await client.call("session.new_window", params, WindowCreatedSchema);
    const [blockId = ""] = created.block_ids;
    this.#tabs.set(created.window_id, { label, group, blocks: new Set() });

    return { windowId: created.window_id, blockId, label };
  }

  async #split(windowId: string, own: OwnTab, block: BlockSpec): Promise<Placement> {
    const choice = chooseSplit(await this.#sizes(own.blocks), own.blocks);

    if (choice === undefined) throw new Error(`Tab ${own.label} has no subagent panes to split`);

    const params = {
      anchor_id: choice.paneId,
      direction: DIRECTIONS[choice.direction],
      side: "after",
      layout: blockLayout(block),
      focus: false,
    };
    const { block_ids } = await this.#options.client.call(
      "session.new_split",
      params,
      SplitCreatedSchema,
    );

    return { windowId, blockId: block_ids[0] ?? "", label: own.label };
  }

  #sizes(blocks: ReadonlySet<string>): Promise<PaneRect[]> {
    return Promise.all(
      [...blocks].map(async (blockId) => {
        const params = { block_id: blockId, method: "size" };
        const size = await this.#options.client.call("block.method", params, SizeSchema);

        return { pane_id: blockId, rect: { width: size.columns, height: size.rows } };
      }),
    );
  }
}
