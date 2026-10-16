import { expect, test } from "bun:test";

import { localValue, secretSpecs } from "../src/secrets.ts";

const jiraToken = secretSpecs.find((spec) => spec.name === "JIRA_API_TOKEN")!;

test("the local value is the first variable that is set and not empty", () => {
  expect(localValue(jiraToken, { JIRA_API_TOKEN: "", JIRA_API_KEY: "key" })).toBe("key");
  expect(localValue(jiraToken, { JIRA_API_TOKEN: "token", JIRA_API_KEY: "key" })).toBe("token");
  expect(localValue(jiraToken, {})).toBeUndefined();
});

test("each secret has one spec", () => {
  const names = secretSpecs.map((spec) => spec.name);
  expect(new Set(names).size).toBe(names.length);
});
