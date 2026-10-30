/** The maximum number of subagents in one tab. */
export const MAX_AGENTS_PER_TAB = 8;

/** A pane and its size in terminal cells. */
export interface PaneRect {
  pane_id: string;
  rect: { width: number; height: number };
}

/** The pane to split for a new subagent, and the direction of the split. */
export interface SplitChoice {
  paneId: string;
  direction: "right" | "down";
}

/**
 * Makes a short slug from a text, for example `hellstack` or `code-review`. Returns `fallback` when
 * the text has no letters or digits.
 */
export function slug(text: string, fallback: string, maxLength = 24): string {
  const value = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, maxLength)
    .replace(/-+$/, "");

  return value === "" ? fallback : value;
}

/**
 * Makes the label of a new subagent tab, for example `hellstack-review-1`. The number is the
 * lowest number that no other tab label uses.
 */
export function tabLabel(project: string, group: string, taken: ReadonlySet<string>): string {
  const base = `${slug(project, "project")}-${slug(group, "work")}`;
  let n = 1;

  while (taken.has(`${base}-${n}`)) n++;

  return `${base}-${n}`;
}

function area(pane: PaneRect): number {
  return pane.rect.width * pane.rect.height;
}

/**
 * Picks the largest pane of the subagents and the direction to split it. A terminal cell is about
 * twice as tall as it is wide, so a pane splits to the right when it is at least twice as wide as
 * it is tall, in cells. Returns `undefined` when no pane is a subagent pane.
 */
export function chooseSplit(
  panes: readonly PaneRect[],
  own: ReadonlySet<string>,
): SplitChoice | undefined {
  const largest = panes
    .filter((pane) => own.has(pane.pane_id))
    .reduce<PaneRect | undefined>(
      (best, pane) => (best && area(best) >= area(pane) ? best : pane),
      undefined,
    );

  if (largest === undefined) return undefined;
  const direction = largest.rect.width >= 2 * largest.rect.height ? "right" : "down";

  return { paneId: largest.pane_id, direction };
}
