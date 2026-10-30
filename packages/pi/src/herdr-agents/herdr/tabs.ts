import { z } from "zod";

import type { HerdrClient } from "./client.ts";
import { chooseSplit, MAX_AGENTS_PER_TAB, tabLabel } from "../layout.ts";

/** The part of the herdr client that the provider uses. Tests give a fake. */
export type HerdrApi = Pick<HerdrClient, "call" | "subscribe">;

/** A pane for a new subagent. */
export interface Placement {
  tabId: string;
  paneId: string;
  /** The label of the tab, for example `hellstack-review-1`. */
  label: string;
}

/** The data that `TabPlanner` uses to make tabs and panes. */
export interface TabPlannerOptions {
  client: HerdrApi;
  workspaceId: string;
  /** The name of the project, for example the base name of the working folder. */
  project: string;
  /** Returns the environment variables for the shells of the new panes. */
  env: () => Record<string, string>;
}

interface OwnTab {
  label: string;
  group: string;
  panes: Set<string>;
}

const TabListSchema = z.object({ tabs: z.array(z.object({ label: z.string() })) });

const TabCreatedSchema = z.object({
  tab: z.object({ tab_id: z.string(), label: z.string() }),
  root_pane: z.object({ pane_id: z.string() }),
});

const LayoutSchema = z.object({
  layout: z.object({
    panes: z.array(
      z.object({
        pane_id: z.string(),
        rect: z.object({ width: z.number(), height: z.number() }),
      }),
    ),
  }),
});

const PaneSchema = z.object({ pane: z.object({ pane_id: z.string() }) });

/**
 * Finds a pane for each new subagent. It keeps the tabs that it made in memory. It puts a new
 * subagent in a tab of the same group that has fewer than `MAX_AGENTS_PER_TAB` subagents, or it
 * makes a new tab. Callers must not call `place` again before the last call is complete.
 */
export class TabPlanner {
  readonly #options: TabPlannerOptions;
  readonly #tabs = new Map<string, OwnTab>();

  constructor(options: TabPlannerOptions) {
    this.#options = options;
  }

  /** Returns a new pane for a subagent of the group. */
  async place(group: string, cwd: string): Promise<Placement> {
    const tab = [...this.#tabs.entries()].find(
      ([, own]) => own.group === group && own.panes.size < MAX_AGENTS_PER_TAB,
    );

    const placement = tab ? await this.#split(tab[0], tab[1], cwd) : await this.#create(group, cwd);
    this.#tabs.get(placement.tabId)?.panes.add(placement.paneId);

    return placement;
  }

  /**
   * Removes a pane. Returns the tab id when the tab has no other subagent panes. The planner then
   * forgets the tab, and the caller must close it.
   */
  release(paneId: string): string | undefined {
    const entry = [...this.#tabs.entries()].find(([, own]) => own.panes.has(paneId));

    if (entry === undefined) return undefined;
    const [tabId, own] = entry;
    own.panes.delete(paneId);

    if (own.panes.size > 0) return undefined;
    this.#tabs.delete(tabId);

    return tabId;
  }

  /** Forgets a tab that herdr closed. */
  forgetTab(tabId: string): void {
    this.#tabs.delete(tabId);
  }

  /** Returns true if the planner made the tab. */
  owns(tabId: string): boolean {
    return this.#tabs.has(tabId);
  }

  async #create(group: string, cwd: string): Promise<Placement> {
    const { client, workspaceId, project } = this.#options;
    const env = this.#options.env();
    const { tabs } = await client.call("tab.list", { workspace_id: workspaceId }, TabListSchema);
    const label = tabLabel(project, group, new Set(tabs.map((tab) => tab.label)));
    const params = { workspace_id: workspaceId, label, cwd, env, focus: false };
    const created = await client.call("tab.create", params, TabCreatedSchema);
    this.#tabs.set(created.tab.tab_id, { label, group, panes: new Set() });

    return { tabId: created.tab.tab_id, paneId: created.root_pane.pane_id, label };
  }

  async #split(tabId: string, own: OwnTab, cwd: string): Promise<Placement> {
    const { client } = this.#options;
    const env = this.#options.env();
    const [first] = own.panes;
    const { layout } = await client.call("pane.layout", { pane_id: first }, LayoutSchema);
    const choice = chooseSplit(layout.panes, own.panes);

    if (choice === undefined) throw new Error(`Tab ${own.label} has no subagent panes to split`);
    const params = { target_pane_id: choice.paneId, direction: choice.direction, cwd, env };
    const { pane } = await client.call("pane.split", { ...params, focus: false }, PaneSchema);

    return { tabId, paneId: pane.pane_id, label: own.label };
  }
}
