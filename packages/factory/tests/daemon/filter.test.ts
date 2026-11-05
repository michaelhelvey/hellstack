import { describe, expect, test } from "bun:test";

import { githubSourceSchema } from "../../src/core/config.ts";
import { eventAction, filterEvents, ruleMatches } from "../../src/daemon/filter.ts";
import { event } from "./helpers.ts";

function github(fields: object) {
  return githubSourceSchema.parse({ type: "github", ...fields });
}

describe("filter", () => {
  test("a rule matches when each field that it sets is equal", () => {
    const e = event({ kind: "security_alert", thread: "gh:acme/api#3" });
    expect(ruleMatches({ action: "ignore" }, e)).toBe(true);
    expect(ruleMatches({ kind: "security_alert", repo: "acme/api", action: "ignore" }, e)).toBe(
      true,
    );
    expect(ruleMatches({ kind: "security_alert", repo: "acme/web", action: "ignore" }, e)).toBe(
      false,
    );
    expect(ruleMatches({ thread: "gh:acme/api#4", action: "ignore" }, e)).toBe(false);
  });

  test("repo matches a repository thread without a number", () => {
    expect(
      ruleMatches({ repo: "acme/api", action: "ignore" }, event({ thread: "gh:acme/api" })),
    ).toBe(true);
  });

  test("the first matching rule wins, else the default", () => {
    const source = github({
      default: "ignore",
      rules: [
        { repo: "acme/api", kind: "ci", action: "ignore" },
        { repo: "acme/api", action: "wake" },
      ],
    });
    expect(eventAction(source, event({ kind: "ci" }))).toBe("ignore");
    expect(eventAction(source, event({ kind: "pr_comment" }))).toBe("wake");
    expect(eventAction(source, event({ thread: "gh:acme/web#1" }))).toBe("ignore");
  });

  test("drops ignore events and keeps the action of inbox and wake events", () => {
    const source = github({});
    const events = [
      event({ id: "a", kind: "mention" }),
      event({ id: "b", kind: "review_requested" }),
      event({ id: "c", kind: "pr_comment" }),
      event({ id: "d", kind: "ci" }),
    ];
    const { passed, ignored } = filterEvents(
      { ...source, rules: [{ kind: "ci", action: "ignore" }, ...source.rules] },
      events,
    );
    expect(passed.map((p) => [p.event.id, p.action])).toEqual([
      ["a", "wake"],
      ["b", "wake"],
      ["c", "inbox"],
    ]);
    expect(ignored).toBe(1);
  });
});
