import { describe, expect, test } from "bun:test";

import { z } from "zod";

import { createElk } from "../skills/tldraw/scripts/lib/elk.ts";
import {
  autoLayout,
  bendThrough,
  manualLayout,
  routedBend,
  type Box,
  type Layout,
  type Point,
  type Size,
} from "../skills/tldraw/scripts/lib/layout.ts";
import { parseSpec, type Diagram } from "../skills/tldraw/scripts/lib/spec.ts";

const elk = createElk(import.meta.url);

function sizes(diagram: Diagram): Map<string, Size> {
  return new Map(diagram.nodes.map((node) => [node.id, { w: 160, h: 80 }]));
}

async function layOut(spec: unknown): Promise<Layout> {
  const diagram = parseSpec(z, spec);
  return autoLayout(
    elk,
    diagram,
    sizes(diagram),
    diagram.edges.map(() => ({ w: 60, h: 24 })),
  );
}

function box(layout: Layout, id: string): Box {
  const found = layout.boxes.get(id);
  if (!found) throw new Error(`no box for ${id}`);
  return found;
}

function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

function nodes(...ids: string[]) {
  return ids.map((id) => ({ id }));
}

describe("parseSpec", () => {
  test("reports unknown keys and unknown edge ends with their paths", () => {
    const spec = { nodes: nodes("a"), edges: [{ from: "a", to: "b", colour: "red" }] };
    expect(() => parseSpec(z, spec)).toThrow(/Unrecognized key: "colour"[\s\S]*edges\[0\]/);
    expect(() => parseSpec(z, spec)).toThrow(/unknown node or group "b"[\s\S]*edges\[0\]\.to/);
  });

  test("rejects groups that contain each other", () => {
    const spec = {
      nodes: nodes("a"),
      groups: [
        { id: "g1", group: "g2" },
        { id: "g2", group: "g1" },
      ],
    };
    expect(() => parseSpec(z, spec)).toThrow("groups contain each other");
  });

  test("rejects a manual layout with a node that has no position", () => {
    const spec = { layout: "manual", nodes: [{ id: "a", x: 0, y: 0 }, { id: "b" }] };
    expect(() => parseSpec(z, spec)).toThrow(/needs "x" and "y"[\s\S]*nodes\[1\]/);
  });

  test("applies spec defaults under the values of each node", () => {
    const diagram = parseSpec(z, {
      defaults: { node: { fill: "solid", color: "blue" }, edge: { route: "elbow" } },
      nodes: [{ id: "a" }, { id: "b", color: "red", shape: "decision" }],
      edges: [{ from: "a", to: "b" }],
      groups: [{ id: "backend" }],
    });
    const [a, b] = diagram.nodes;
    expect(a).toMatchObject({ shape: "rectangle", fill: "solid", color: "blue", size: "m" });
    expect(b).toMatchObject({ shape: "diamond", fill: "solid", color: "red" });
    expect(diagram.edges[0]).toMatchObject({ route: "elbow", arrowheadEnd: "arrow" });
    expect(diagram.groups[0]).toMatchObject({ name: "backend", color: "grey" });
  });
});

describe("bendThrough", () => {
  // tldraw puts the middle of an arc at the chord midpoint + (-uy, ux) * bend.
  function tldrawMiddle(start: Point, end: Point, bend: number): Point {
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const u = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    return { x: mid.x - u.y * bend, y: mid.y + u.x * bend };
  }

  test.each([
    [{ x: 0, y: 0 }, { x: 400, y: 0 }, 80],
    [{ x: 0, y: 0 }, { x: 400, y: 0 }, -80],
    [{ x: 100, y: 50 }, { x: -200, y: 300 }, 150],
  ])("gives the bend of the arc through a point (%p to %p, bend %p)", (start, end, bend) => {
    expect(bendThrough(start, end, tldrawMiddle(start, end, bend))).toBe(bend);
  });

  test("gives no bend for a point near the chord", () => {
    expect(bendThrough({ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 200, y: 5 })).toBe(0);
  });
});

describe("routedBend", () => {
  const diagram = parseSpec(z, { nodes: nodes("a") });
  const start = { x: 0, y: 0 };
  const end = { x: 400, y: 0 };
  const far = { x: 200, y: 200 };

  test("limits the curve of a short forward edge", () => {
    expect(routedBend(diagram, start, end, { point: far, exact: false })).toBe(48);
  });

  test("goes through the route point of a labeled or long edge", () => {
    expect(routedBend(diagram, start, end, { point: far, exact: true })).toBe(200);
  });

  test("goes through the route point of a back edge", () => {
    expect(routedBend(diagram, end, start, { point: far, exact: false })).toBe(-200);
  });
});

describe("autoLayout", () => {
  test("puts each target after its source in the layout direction", async () => {
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ];
    const right = await layOut({ nodes: nodes("a", "b", "c"), edges });
    expect(box(right, "b").x).toBeGreaterThan(box(right, "a").x + box(right, "a").w);
    expect(box(right, "c").x).toBeGreaterThan(box(right, "b").x + box(right, "b").w);
    const down = await layOut({ direction: "down", nodes: nodes("a", "b", "c"), edges });
    expect(box(down, "b").y).toBeGreaterThan(box(down, "a").y + box(down, "a").h);
  });

  test("puts a source before its target when the spec lists the source last", async () => {
    const layout = await layOut({
      nodes: nodes("a", "b", "late"),
      edges: [
        { from: "a", to: "b" },
        { from: "late", to: "b" },
      ],
    });
    expect(box(layout, "late").x).toBeLessThan(box(layout, "b").x);
  });

  test("breaks a cycle at the edge that goes back in the spec order", async () => {
    const layout = await layOut({
      nodes: nodes("a", "b", "c"),
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ],
    });
    expect(box(layout, "a").x).toBeLessThan(box(layout, "b").x);
    expect(box(layout, "b").x).toBeLessThan(box(layout, "c").x);
  });

  test("keeps the members of nested groups in their group boxes", async () => {
    const layout = await layOut({
      groups: [{ id: "outer" }, { id: "inner", group: "outer" }],
      nodes: [{ id: "a" }, { id: "b", group: "outer" }, { id: "c", group: "inner" }],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "a", to: "inner" },
      ],
    });
    expect(contains(box(layout, "outer"), box(layout, "b"))).toBe(true);
    expect(contains(box(layout, "outer"), box(layout, "inner"))).toBe(true);
    expect(contains(box(layout, "inner"), box(layout, "c"))).toBe(true);
    expect(contains(box(layout, "outer"), box(layout, "a"))).toBe(false);
  });
});

describe("manualLayout", () => {
  test("puts each node center at its position and fits groups around their members", () => {
    const diagram = parseSpec(z, {
      layout: "manual",
      groups: [{ id: "g" }],
      nodes: [
        { id: "a", x: 100, y: 100, group: "g" },
        { id: "b", x: 500, y: 300, group: "g" },
      ],
    });
    const layout = manualLayout(diagram, sizes(diagram));
    expect(box(layout, "a")).toEqual({ x: 20, y: 60, w: 160, h: 80 });
    expect(contains(box(layout, "g"), box(layout, "a"))).toBe(true);
    expect(contains(box(layout, "g"), box(layout, "b"))).toBe(true);
  });
});
