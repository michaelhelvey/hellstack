import type { Entry } from "./entries.ts";
import type { Integration } from "./integrations.ts";
import type { Layers } from "./layers.ts";
import type { Roots } from "./roots.ts";

/** The data that the sync gives to the sync manifest of a package. */
export interface SyncContext {
  /** The directory of the package. */
  packageDir: string;
  /** The harness directories. */
  roots: Roots;
  /** The layers that are on for this machine. */
  layers: Layers;
}

/** The files and integrations that one package adds to the sync. */
export interface SyncPlan {
  entries: Entry[];
  /** The integrations to run after the sync writes the files, in order. */
  integrations?: Integration[];
}

/** Makes the plan of a package for one machine. */
export type SyncPlanner = (context: SyncContext) => SyncPlan | Promise<SyncPlan>;

/** A sync manifest. The sync loads it from the default export of `hellstack.sync.ts`. */
export interface SyncManifest {
  plan: SyncPlanner;
}

/**
 * Makes a sync manifest. Use it as the default export of `hellstack.sync.ts` at the root of a
 * package.
 */
export function defineSync(plan: SyncPlanner): SyncManifest {
  return { plan };
}
