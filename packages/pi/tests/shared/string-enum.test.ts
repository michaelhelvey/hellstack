import { expect, test } from "bun:test";

import { StringEnum as PiStringEnum } from "@earendil-works/pi-ai";

import { StringEnum } from "../../src/shared/string-enum.ts";

test("makes the same JSON schema as the StringEnum of pi-ai", () => {
  const options = { description: "The scope", default: "all" } as const;

  expect(JSON.parse(JSON.stringify(StringEnum(["project", "all"], options)))).toEqual(
    JSON.parse(JSON.stringify(PiStringEnum(["project", "all"], options))),
  );
});
