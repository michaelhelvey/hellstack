import { Schema } from "effect";

/** A GitHub notification thread of the user. */
export interface GithubItem {
  readonly kind: "github";
  /** The thread id. */
  readonly id: string;
  readonly title: string;
  /** The web URL of the subject, or of the repository if the subject has no web URL. */
  readonly url: string;
  /** The full name of the repository, for example `owner/name`. */
  readonly repo: string;
  /** Why the user got the notification, for example `review_requested`. */
  readonly reason: string;
  /** The subject type, for example `PullRequest`. */
  readonly type: string;
  readonly updatedAt: string;
}

/** An unresolved Sentry issue. */
export interface SentryItem {
  readonly kind: "sentry";
  /** The issue id. */
  readonly id: string;
  readonly title: string;
  readonly url: string;
  /** The project slug. */
  readonly project: string;
  /** The short id, for example `PLATFORM-Z`. */
  readonly shortId: string;
  /** The number of events of the issue. */
  readonly count: number;
  readonly lastSeen: string;
}

/** One row of the dashboard. The `kind` tells the source of the item. */
export type Item = GithubItem | SentryItem;

/** The sources of items, in the order that the dashboard shows them. */
export const KINDS = ["github", "sentry"] as const satisfies ReadonlyArray<Item["kind"]>;

/** The key and the button label of each action. */
export const ACTIONS = {
  done: { key: "d", label: "done" },
  resolve: { key: "r", label: "resolve" },
  hide: { key: "h", label: "hide" },
} as const;

/** The name of an action that the user can do on an item. */
export type ActionName = keyof typeof ACTIONS;

/** A failed call to a source of items, or to the local state of the dashboard. */
export class DashError extends Schema.TaggedError<DashError, { readonly brand: unique symbol }>()(
  "DashError",
  {
    message: Schema.String,
  },
) {}

/** A key that is unique across all kinds of items. */
export const itemKey = (item: Item): string => `${item.kind}:${item.id}`;
