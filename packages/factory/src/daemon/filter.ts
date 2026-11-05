import {
  threadRepo,
  type FactoryEvent,
  type Rule,
  type RuleAction,
  type SourceConfig,
} from "../core/index.ts";

/** The event kinds that mention the user or ask for their review or their action. */
export const userKinds: ReadonlySet<string> = new Set(["mention", "review_requested", "assigned"]);

/** The events that pass the filter, and the count of events that it dropped. */
export interface Filtered {
  passed: FactoryEvent[];
  ignored: number;
}

/** Returns true when each field that `rule` sets is equal to the event field. */
export function ruleMatches(rule: Rule, event: FactoryEvent): boolean {
  const fields = { kind: event.kind, thread: event.thread, repo: threadRepo(event.thread) };
  return (["kind", "thread", "repo"] as const).every(
    (key) => rule[key] === undefined || rule[key] === fields[key],
  );
}

/** Returns the action of the first rule that matches the event, or the source default. */
export function eventAction(source: SourceConfig, event: FactoryEvent): RuleAction {
  return source.rules.find((rule) => ruleMatches(rule, event))?.action ?? source.default;
}

/** Returns true when an event with `action` goes to routing. */
export function passes(action: RuleAction, event: FactoryEvent): boolean {
  if (action === "mention-only") return userKinds.has(event.kind);
  return action === "candidate";
}

/** Applies the rules of `source` to the events. */
export function filterEvents(source: SourceConfig, events: FactoryEvent[]): Filtered {
  const passed = events.filter((event) => passes(eventAction(source, event), event));
  return { passed, ignored: events.length - passed.length };
}
