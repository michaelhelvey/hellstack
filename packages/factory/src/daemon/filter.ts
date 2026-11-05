import {
  threadRepo,
  type FactoryEvent,
  type Rule,
  type RuleAction,
  type SourceConfig,
} from "../core/index.ts";

/** An event that passed the filter and the action of its rule: `inbox` or `wake`. */
export interface Passed {
  event: FactoryEvent;
  action: Exclude<RuleAction, "ignore">;
}

/** The events that pass the filter, and the count of events that it dropped. */
export interface Filtered {
  passed: Passed[];
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

/** Applies the rules of `source` to the events. It drops the events with the action `ignore`. */
export function filterEvents(source: SourceConfig, events: FactoryEvent[]): Filtered {
  const passed = events.flatMap((event): Passed[] => {
    const action = eventAction(source, event);
    return action === "ignore" ? [] : [{ event, action }];
  });
  return { passed, ignored: events.length - passed.length };
}
