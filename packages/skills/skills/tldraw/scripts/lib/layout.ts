import type { ELK, ElkExtendedEdge, ElkNode, ElkPoint } from "elkjs/lib/elk-api.js";

import type { Diagram, DiagramEdge, DiagramGroup, DiagramNode } from "./spec.ts";

/** A rectangle in canvas units. `x` and `y` are the top-left corner. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A point in canvas units. */
export interface Point {
  x: number;
  y: number;
}

/** The width and height of a node or a label. */
export interface Size {
  w: number;
  h: number;
}

/**
 * A point on the ELK route of an edge. `exact` is true if the arc must go through the point: the
 * point is the center of the edge label, or the route goes past other nodes.
 */
export interface RoutePoint {
  point: Point;
  exact: boolean;
}

/** The position of each node and group, and a point on the route of each edge. */
export interface Layout {
  boxes: Map<string, Box>;
  midpoints: Map<string, RoutePoint | undefined>;
}

/** A node with its size and position, ready to draw. */
export type PlacedNode = DiagramNode & Box;

/** A group with its size and position, ready to draw. */
export type PlacedGroup = DiagramGroup & Box & { font: DiagramNode["font"] };

/** An edge with its end points and bend, ready to draw. */
export type PlacedEdge = DiagramEdge & {
  start: Point;
  end: Point;
  bend: number;
  labelPosition: number;
};

/** All the shapes to draw, in canvas units. */
export interface DrawPlan {
  title: { text: string; x: number; y: number; font: DiagramNode["font"] } | undefined;
  groups: PlacedGroup[];
  nodes: PlacedNode[];
  edges: PlacedEdge[];
}

const SIZE_METRICS = {
  s: { pad: 14, minW: 120, maxW: 240, minH: 56 },
  m: { pad: 22, minW: 150, maxW: 300, minH: 76 },
  l: { pad: 30, minW: 190, maxW: 400, minH: 100 },
  xl: { pad: 40, minW: 240, maxW: 520, minH: 130 },
} as const;

// Shapes with slanted or round sides have less room for a label than their bounding box.
const GEO_ROOM: Readonly<Partial<Record<DiagramNode["shape"], readonly [number, number]>>> = {
  ellipse: [1.2, 1.3],
  oval: [1.15, 1],
  diamond: [1.3, 1.8],
  hexagon: [1.2, 1],
  octagon: [1.1, 1.15],
  pentagon: [1.25, 1.4],
  triangle: [1.6, 2],
  cloud: [1.35, 1.5],
  star: [1.8, 1.9],
  heart: [1.5, 1.6],
  rhombus: [1.3, 1],
  "rhombus-2": [1.3, 1],
  trapezoid: [1.3, 1],
};

const GROUP_PADDING = 40;
const GROUP_NAME_ROOM = 24;

/**
 * Gives the first size for a node: wide enough for its label on one line, up to a maximum width.
 * tldraw then makes the node taller if the label wraps.
 */
export function planNodeSize(node: DiagramNode, textWidth: number): Size {
  const metrics = SIZE_METRICS[node.size];
  const [roomW, roomH] = GEO_ROOM[node.shape] ?? [1, 1];
  const labelW = Math.min(Math.max(textWidth + metrics.pad * 2, metrics.minW), metrics.maxW);
  return {
    w: node.w ?? Math.round(labelW * roomW),
    h: node.h ?? Math.round(metrics.minH * roomH),
  };
}

function parentOf(diagram: Diagram, id: string): string | undefined {
  const item = diagram.nodes.find((n) => n.id === id) ?? diagram.groups.find((g) => g.id === id);
  return item?.group;
}

/** Gives the groups that contain an item, from the nearest group out. */
export function ancestors(diagram: Diagram, id: string): string[] {
  const chain: string[] = [];
  for (
    let parent = parentOf(diagram, id);
    parent !== undefined;
    parent = parentOf(diagram, parent)
  ) {
    chain.push(parent);
  }
  return chain;
}

function commonContainer(diagram: Diagram, a: string, b: string): string {
  const others = new Set(ancestors(diagram, b));
  return ancestors(diagram, a).find((id) => others.has(id) && id !== a && id !== b) ?? "root";
}

/**
 * Gives an order for all nodes and groups. ELK breaks cycles by the order of the graph, so each
 * group takes the place of its first node in the spec.
 */
export function specOrder(diagram: Diagram): Map<string, number> {
  const order = new Map(diagram.nodes.map((node, i) => [node.id, i]));
  diagram.nodes.forEach((node, i) => {
    for (const group of ancestors(diagram, node.id)) {
      order.set(group, Math.min(order.get(group) ?? Infinity, i));
    }
  });
  for (const group of diagram.groups) {
    order.set(group.id, order.get(group.id) ?? diagram.nodes.length);
  }
  return order;
}

// ELK does not give these options from a parent to its children, so each group gets them too.
function spacingOptions(diagram: Diagram): Record<string, string> {
  const { nodes, layers } = diagram.spacing;
  return {
    "elk.spacing.nodeNode": String(nodes),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(layers),
    "elk.spacing.edgeNode": String(nodes / 2),
    "elk.spacing.edgeEdge": "20",
    "elk.layered.spacing.edgeNodeBetweenLayers": String(layers / 3),
    "elk.spacing.edgeLabel": "8",
    "elk.spacing.componentComponent": String(layers),
  };
}

function elkEdges(diagram: Diagram, labelSizes: Size[]): Map<string, ElkExtendedEdge[]> {
  const byContainer = new Map<string, ElkExtendedEdge[]>();
  diagram.edges.forEach((edge, i) => {
    const container = commonContainer(diagram, edge.from, edge.to);
    const size = labelSizes[i] ?? { w: 0, h: 0 };
    const labels = edge.text
      ? [{ id: `label-${i}`, text: edge.text, width: size.w, height: size.h }]
      : [];
    const list = byContainer.get(container) ?? [];
    list.push({ id: `edge-${i}`, sources: [edge.from], targets: [edge.to], labels });
    byContainer.set(container, list);
  });
  return byContainer;
}

/** Makes the ELK graph for a diagram. `sizes` has the size of each node, by id. */
export function elkGraph(diagram: Diagram, sizes: Map<string, Size>, labelSizes: Size[]): ElkNode {
  const edges = elkEdges(diagram, labelSizes);
  const order = specOrder(diagram);
  const spacing = spacingOptions(diagram);
  const padding = `[top=${GROUP_PADDING + GROUP_NAME_ROOM},left=${GROUP_PADDING},bottom=${GROUP_PADDING},right=${GROUP_PADDING}]`;
  function children(parent: string | undefined): ElkNode[] {
    const groups = diagram.groups.filter((g) => g.group === parent);
    const nodes = diagram.nodes.filter((n) => n.group === parent);
    const items: ElkNode[] = [
      ...groups.map((group) => ({
        id: group.id,
        layoutOptions: { ...spacing, "elk.padding": padding },
        children: children(group.id),
        edges: edges.get(group.id) ?? [],
      })),
      ...nodes.map((node) => ({
        id: node.id,
        width: sizes.get(node.id)?.w ?? 0,
        height: sizes.get(node.id)?.h ?? 0,
      })),
    ];
    return items.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }
  return {
    id: "root",
    layoutOptions: {
      ...spacing,
      "elk.algorithm": "layered",
      "elk.direction": diagram.direction.toUpperCase(),
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeLabels.placement": "CENTER",
      "elk.edgeLabels.inline": "true",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.cycleBreaking.strategy": "GREEDY_MODEL_ORDER",
      "elk.layered.mergeEdges": "false",
      "elk.separateConnectedComponents": "true",
    },
    children: children(undefined),
    edges: edges.get("root") ?? [],
  };
}

/** Gives the point at half the length of a polyline. */
export function pointAtHalfLength(points: ElkPoint[]): Point | undefined {
  const segments = points.slice(1).map((b, i) => ({ a: points[i] ?? b, b }));
  let remaining =
    segments.reduce((sum, s) => sum + Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), 0) / 2;
  for (const { a, b } of segments) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= length) {
      const t = length === 0 ? 0 : remaining / length;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= length;
  }
  return points.at(-1);
}

function edgeMidpoint(edge: ElkExtendedEdge, offset: Point): RoutePoint | undefined {
  const label = edge.labels?.[0];
  if (label?.x !== undefined && label.y !== undefined) {
    const w = label.width ?? 0;
    const h = label.height ?? 0;
    return { point: { x: offset.x + label.x + w / 2, y: offset.y + label.y + h / 2 }, exact: true };
  }
  const section = edge.sections?.[0];
  if (!section) return undefined;
  const bends = section.bendPoints ?? [];
  const point = pointAtHalfLength([section.startPoint, ...bends, section.endPoint]);
  // A route between two next layers has two bends. More bends go past other nodes.
  return (
    point && { point: { x: offset.x + point.x, y: offset.y + point.y }, exact: bends.length > 2 }
  );
}

/** Converts an ELK result to boxes in canvas units, and gets a point on each edge route. */
export function readElkResult(result: ElkNode): Layout {
  const layout: Layout = { boxes: new Map(), midpoints: new Map() };
  function visit(item: ElkNode, offset: Point): void {
    const origin = { x: offset.x + (item.x ?? 0), y: offset.y + (item.y ?? 0) };
    if (item.id !== "root") {
      layout.boxes.set(item.id, { ...origin, w: item.width ?? 0, h: item.height ?? 0 });
    }
    for (const edge of item.edges ?? []) layout.midpoints.set(edge.id, edgeMidpoint(edge, origin));
    for (const child of item.children ?? []) visit(child, origin);
  }
  visit(result, { x: 0, y: 0 });
  return layout;
}

/** Puts the nodes in position with ELK. */
export async function autoLayout(
  elk: ELK,
  diagram: Diagram,
  sizes: Map<string, Size>,
  labelSizes: Size[],
): Promise<Layout> {
  return readElkResult(await elk.layout(elkGraph(diagram, sizes, labelSizes)));
}

function fitGroup(diagram: Diagram, group: DiagramGroup, boxes: Map<string, Box>): void {
  const childGroups = diagram.groups.filter((g) => g.group === group.id);
  for (const child of childGroups) fitGroup(diagram, child, boxes);
  const members = [...childGroups, ...diagram.nodes.filter((n) => n.group === group.id)]
    .map((item) => boxes.get(item.id))
    .filter((box) => box !== undefined);
  if (members.length === 0) return;
  const left = Math.min(...members.map((b) => b.x)) - GROUP_PADDING;
  const top = Math.min(...members.map((b) => b.y)) - GROUP_PADDING - GROUP_NAME_ROOM;
  const right = Math.max(...members.map((b) => b.x + b.w)) + GROUP_PADDING;
  const bottom = Math.max(...members.map((b) => b.y + b.h)) + GROUP_PADDING;
  boxes.set(group.id, { x: left, y: top, w: right - left, h: bottom - top });
}

/** Puts each node with its center at its `x` and `y`, and fits each group around its members. */
export function manualLayout(diagram: Diagram, sizes: Map<string, Size>): Layout {
  const boxes = new Map<string, Box>();
  for (const node of diagram.nodes) {
    const { w, h } = sizes.get(node.id) ?? { w: 0, h: 0 };
    boxes.set(node.id, { x: (node.x ?? 0) - w / 2, y: (node.y ?? 0) - h / 2, w, h });
  }
  for (const group of diagram.groups.filter((g) => g.group === undefined)) {
    fitGroup(diagram, group, boxes);
  }
  return { boxes, midpoints: new Map() };
}

function center(box: Box): Point {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/**
 * Gives the `bend` of a tldraw arc arrow from `start` to `end` that goes through `point`. tldraw
 * moves the middle of the arc from the chord midpoint by `bend` along the normal (-dy, dx).
 */
export function bendThrough(start: Point, end: Point, point: Point | undefined): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!point || length === 0) return 0;
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const bend = ((point.y - mid.y) * dx - (point.x - mid.x) * dy) / length;
  return Math.abs(bend) < 12 ? 0 : Math.round(bend);
}

const DIRECTION_VECTORS: Readonly<Record<Diagram["direction"], Point>> = {
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  up: { x: 0, y: -1 },
};

/**
 * Gives the bend that follows the ELK route. A short forward edge gets only a small curve. Other
 * edges go through the route point, because ELK kept that point clear of nodes.
 */
export function routedBend(
  diagram: Diagram,
  start: Point,
  end: Point,
  route: RoutePoint | undefined,
): number {
  const bend = bendThrough(start, end, route?.point);
  const direction = DIRECTION_VECTORS[diagram.direction];
  const forward = (end.x - start.x) * direction.x + (end.y - start.y) * direction.y > 0;
  if (!forward || route?.exact) return bend;
  const limit = Math.hypot(end.x - start.x, end.y - start.y) * 0.12;
  return Math.round(Math.max(-limit, Math.min(limit, bend)));
}

function pairKey(edge: DiagramEdge): string {
  return [edge.from, edge.to].sort().join("\n");
}

/** Gives a bend to each edge that shares its two ends with other edges, so that they separate. */
export function parallelBends(edges: DiagramEdge[]): number[] {
  const counts = new Map<string, number>();
  for (const edge of edges) counts.set(pairKey(edge), (counts.get(pairKey(edge)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return edges.map((edge) => {
    const total = counts.get(pairKey(edge)) ?? 1;
    const index = seen.get(pairKey(edge)) ?? 0;
    seen.set(pairKey(edge), index + 1);
    const sign = edge.from < edge.to ? 1 : -1;
    return total < 2 ? 0 : sign * (index - (total - 1) / 2) * 70;
  });
}

function edgeBend(
  diagram: Diagram,
  edge: DiagramEdge,
  ends: [Point, Point],
  hint: {
    midpoint: RoutePoint | undefined;
    parallel: number;
  },
): number {
  if (edge.route === "elbow") return 0;
  if (edge.bend !== undefined) return edge.bend;
  const routed = edge.route === "curved" ? routedBend(diagram, ...ends, hint.midpoint) : 0;
  return routed || hint.parallel;
}

function boxOf(layout: Layout, id: string): Box {
  const box = layout.boxes.get(id);
  if (!box) throw new Error(`No position for "${id}"`);
  return box;
}

function rounded(box: Box): Box {
  return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) };
}

function titlePlan(diagram: Diagram, layout: Layout): DrawPlan["title"] {
  if (!diagram.title) return undefined;
  const boxes = [...layout.boxes.values()];
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { text: diagram.title, x: Math.round(x), y: Math.round(y - 90), font: diagram.font };
}

/** Combines a diagram and its layout into the list of shapes to draw. */
export function drawPlan(diagram: Diagram, layout: Layout): DrawPlan {
  function depth(group: DiagramGroup): number {
    return ancestors(diagram, group.id).length;
  }
  const groups = [...diagram.groups]
    .sort((a, b) => depth(a) - depth(b))
    .filter((group) => layout.boxes.has(group.id))
    .map((group) => ({ font: diagram.font, ...group, ...rounded(boxOf(layout, group.id)) }));
  const nodes = diagram.nodes.map((node) => ({ ...node, ...rounded(boxOf(layout, node.id)) }));
  const parallel = parallelBends(diagram.edges);
  const edges = diagram.edges.map((edge, i) => {
    const start = center(boxOf(layout, edge.from));
    const end = center(boxOf(layout, edge.to));
    const hint = { midpoint: layout.midpoints.get(`edge-${i}`), parallel: parallel[i] ?? 0 };
    const bend = edgeBend(diagram, edge, [start, end], hint);
    return { ...edge, start, end, bend, labelPosition: edge.labelPosition ?? 0.5 };
  });
  return { title: titlePlan(diagram, layout), groups, nodes, edges };
}
