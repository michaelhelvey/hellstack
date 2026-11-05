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
        { repo: "acme/api", action: "candidate" },
      ],
    });
    expect(eventAction(source, event({ kind: "ci" }))).toBe("ignore");
    expect(eventAction(source, event({ kind: "pr_comment" }))).toBe("candidate");
    expect(eventAction(source, event({ thread: "gh:acme/web#1" }))).toBe("ignore");
  });

  test("mention-only passes only the events for the user", () => {
    const source = github({ default: "mention-only" });
    const events = [
      event({ id: "a", kind: "mention" }),
      event({ id: "b", kind: "review_requested" }),
      event({ id: "c", kind: "pr_comment" }),
      event({ id: "d", kind: "assigned" }),
    ];
    const { passed, ignored } = filterEvents(source, events);
    expect(passed.map((e) => e.id)).toEqual(["a", "b", "d"]);
    expect(ignored).toBe(1);
  });
});
