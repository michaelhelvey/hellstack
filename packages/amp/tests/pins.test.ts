import { expect, test } from "bun:test";

import { chinchillaModes } from "../plugin/hellstack/index.ts";
import { pinProblems } from "../src/pins.ts";

const medium = chinchillaModes.find((mode) => mode.key === "chinchilla-medium")!;

test("a pin with an effort that its model does not support is a problem", () => {
  const efforts = new Map([
    ["zhipuai/glm-5.3", ["low", "high", "max"]],
    ["alibaba/qwen3.8-max", ["none", "low", "medium", "xhigh"]],
    ["deepseek/deepseek-v4.1-flash", ["none", "high", "max"]],
  ]);
  const broken = { ...medium, agent: { model: medium.agent.model, effort: "medium" as const } };
  expect(pinProblems(efforts, [medium])).toEqual([]);
  expect(pinProblems(efforts, [broken])).toEqual([
    "chinchilla-medium agent: zhipuai/glm-5.3 does not support effort medium (it supports low, high, max)",
  ]);
});

test("a pin with a model that Amp does not have is a problem", () => {
  expect(pinProblems(new Map(), [medium])).toHaveLength(3);
});
