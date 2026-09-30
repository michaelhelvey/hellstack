import type { z } from "zod";

/** The zod namespace. The caller supplies it, because the script loads zod at run time. */
export type Zod = typeof z;

/** The colors of tldraw. */
export const COLORS = [
  "black",
  "grey",
  "light-violet",
  "violet",
  "blue",
  "light-blue",
  "yellow",
  "orange",
  "green",
  "light-green",
  "light-red",
  "red",
  "white",
] as const;

/** The geo shapes of tldraw. */
export const GEOS = [
  "rectangle",
  "ellipse",
  "diamond",
  "triangle",
  "hexagon",
  "pentagon",
  "octagon",
  "oval",
  "cloud",
  "star",
  "heart",
  "rhombus",
  "rhombus-2",
  "trapezoid",
  "x-box",
  "check-box",
  "arrow-right",
  "arrow-left",
  "arrow-up",
  "arrow-down",
] as const;

const SHAPE_ALIASES: Readonly<Record<string, string>> = {
  rect: "rectangle",
  box: "rectangle",
  square: "rectangle",
  circle: "ellipse",
  pill: "oval",
  decision: "diamond",
  sticky: "note",
  label: "text",
};

const ARROWHEADS = [
  "none",
  "arrow",
  "triangle",
  "square",
  "dot",
  "pipe",
  "diamond",
  "inverted",
  "bar",
] as const;

/** The directions that the automatic layout can go in. */
export const DIRECTIONS = ["right", "down", "left", "up"] as const;

function styleSchemas(zod: Zod) {
  const color = zod.enum(COLORS);
  const dash = zod.enum(["draw", "solid", "dashed", "dotted"]);
  const size = zod.enum(["s", "m", "l", "xl"]);
  const font = zod.enum(["draw", "sans", "serif", "mono"]);
  const align = zod.enum(["start", "middle", "end"]);
  const shape = zod.preprocess(
    (value) => (typeof value === "string" ? (SHAPE_ALIASES[value] ?? value) : value),
    zod.enum([...GEOS, "note", "text"]),
  );
  const node = {
    shape: shape.optional(),
    color: color.optional(),
    labelColor: color.optional(),
    fill: zod.enum(["none", "semi", "solid", "pattern", "fill", "lined-fill"]).optional(),
    dash: dash.optional(),
    size: size.optional(),
    font: font.optional(),
    align: align.optional(),
    verticalAlign: align.optional(),
  };
  const edge = {
    color: color.optional(),
    labelColor: color.optional(),
    dash: dash.optional(),
    size: size.optional(),
    font: font.optional(),
    route: zod.enum(["curved", "straight", "elbow"]).optional(),
    arrowheadStart: zod.enum(ARROWHEADS).optional(),
    arrowheadEnd: zod.enum(ARROWHEADS).optional(),
  };
  return { color, node, edge };
}

function baseSchema(zod: Zod) {
  const style = styleSchemas(zod);
  const node = zod.strictObject({
    id: zod.string().min(1),
    text: zod.string().default(""),
    ...style.node,
    w: zod.number().positive().optional(),
    h: zod.number().positive().optional(),
    x: zod.number().optional(),
    y: zod.number().optional(),
    group: zod.string().optional(),
  });
  const edge = zod.strictObject({
    from: zod.string(),
    to: zod.string(),
    text: zod.string().default(""),
    ...style.edge,
    bend: zod.number().optional(),
    labelPosition: zod.number().min(0).max(1).optional(),
  });
  const group = zod.strictObject({
    id: zod.string().min(1),
    name: zod.string().optional(),
    color: style.color.optional(),
    group: zod.string().optional(),
  });
  return zod.strictObject({
    $schema: zod.string().optional(),
    title: zod.string().optional(),
    layout: zod.enum(["auto", "manual"]).default("auto"),
    direction: zod.enum(DIRECTIONS).default("right"),
    spacing: zod
      .strictObject({
        nodes: zod.number().min(0).optional(),
        layers: zod.number().min(0).optional(),
      })
      .default({}),
    defaults: zod
      .strictObject({
        node: zod.strictObject(style.node).default({}),
        edge: zod.strictObject(style.edge).default({}),
      })
      .default({ node: {}, edge: {} }),
    nodes: zod.array(node).min(1),
    edges: zod.array(edge).default([]),
    groups: zod.array(group).default([]),
  });
}

/** A spec as the schema gives it, before the defaults are applied. */
export type ParsedSpec = z.output<ReturnType<typeof baseSchema>>;

type Issue = (message: string, path: (string | number)[]) => void;

function checkUniqueIds(spec: ParsedSpec, issue: Issue): Set<string> {
  const ids = new Set<string>();
  for (const key of ["nodes", "groups"] as const) {
    spec[key].forEach((item, i) => {
      if (ids.has(item.id)) issue(`duplicate id "${item.id}"`, [key, i, "id"]);
      ids.add(item.id);
    });
  }
  return ids;
}

function checkGroupReferences(spec: ParsedSpec, issue: Issue): void {
  const groupIds = new Set(spec.groups.map((g) => g.id));
  for (const key of ["nodes", "groups"] as const) {
    spec[key].forEach((item, i) => {
      if (item.group !== undefined && !groupIds.has(item.group)) {
        issue(`unknown group "${item.group}"`, [key, i, "group"]);
      }
    });
  }
}

function checkEdgeReferences(spec: ParsedSpec, ids: Set<string>, issue: Issue): void {
  spec.edges.forEach((edge, i) => {
    for (const end of ["from", "to"] as const) {
      if (!ids.has(edge[end])) issue(`unknown node or group "${edge[end]}"`, ["edges", i, end]);
    }
  });
}

function hasGroupCycle(spec: ParsedSpec, start: string): boolean {
  const parents = new Map(spec.groups.map((g) => [g.id, g.group]));
  const seen = new Set([start]);
  for (let parent = parents.get(start); parent !== undefined; parent = parents.get(parent)) {
    if (seen.has(parent)) return true;
    seen.add(parent);
  }
  return false;
}

function checkGroupCycles(spec: ParsedSpec, issue: Issue): void {
  spec.groups.forEach((group, i) => {
    if (hasGroupCycle(spec, group.id)) issue("groups contain each other", ["groups", i, "group"]);
  });
}

function checkManualPositions(spec: ParsedSpec, issue: Issue): void {
  if (spec.layout !== "manual") return;
  spec.nodes.forEach((node, i) => {
    if (node.x === undefined || node.y === undefined) {
      issue('"layout": "manual" needs "x" and "y" on every node', ["nodes", i]);
    }
  });
}

function checkReferences(spec: ParsedSpec, ctx: z.RefinementCtx): void {
  function issue(message: string, path: (string | number)[]): void {
    ctx.addIssue({ code: "custom", message, path });
  }
  const ids = checkUniqueIds(spec, issue);
  checkGroupReferences(spec, issue);
  checkEdgeReferences(spec, ids, issue);
  checkGroupCycles(spec, issue);
  checkManualPositions(spec, issue);
}

/** Makes the zod schema for a diagram spec. */
export function makeSpecSchema(zod: Zod) {
  return baseSchema(zod).superRefine(checkReferences);
}

type ParsedNode = ParsedSpec["nodes"][number];
type ParsedEdge = ParsedSpec["edges"][number];
type ParsedGroup = ParsedSpec["groups"][number];
type NodeStyle = ParsedSpec["defaults"]["node"];
type EdgeStyle = ParsedSpec["defaults"]["edge"];

/** The type `T` with each property present and not `undefined`. */
type Filled<T> = { [K in keyof T]-?: Exclude<T[K], undefined> };

type NodeDefaults = Filled<Omit<NodeStyle, "labelColor">>;
type EdgeDefaults = Filled<Omit<EdgeStyle, "labelColor">>;

/** A node with all of its style properties set. */
export type DiagramNode = Omit<ParsedNode, keyof NodeStyle> &
  NodeDefaults & { labelColor: NodeStyle["labelColor"] };

/** An edge with all of its style properties set. */
export type DiagramEdge = Omit<ParsedEdge, keyof EdgeStyle> &
  EdgeDefaults & { labelColor: EdgeStyle["labelColor"] };

/** A group with its name and color set. */
export type DiagramGroup = Omit<ParsedGroup, "name" | "color"> &
  Filled<Pick<ParsedGroup, "name" | "color">>;

/** A spec with the defaults applied. */
export interface Diagram {
  title: string | undefined;
  layout: ParsedSpec["layout"];
  direction: ParsedSpec["direction"];
  spacing: { nodes: number; layers: number };
  font: DiagramNode["font"];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  groups: DiagramGroup[];
}

const NODE_DEFAULTS: NodeDefaults = {
  shape: "rectangle",
  color: "black",
  fill: "none",
  dash: "draw",
  size: "m",
  font: "draw",
  align: "middle",
  verticalAlign: "middle",
};

const EDGE_DEFAULTS: EdgeDefaults = {
  color: "black",
  dash: "draw",
  size: "m",
  font: "draw",
  route: "curved",
  arrowheadStart: "none",
  arrowheadEnd: "arrow",
};

/** Gives each property of `defaults` the value from `value`, if that value is not `undefined`. */
function withDefaults<D extends object>(
  value: { [K in keyof D]?: D[K] | undefined },
  defaults: D,
): D {
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof D)[]) {
    const own = value[key];
    if (own !== undefined) result[key] = own;
  }
  return result;
}

/** Applies the built-in defaults and the `defaults` of the spec to each item. */
export function resolveSpec(spec: ParsedSpec): Diagram {
  const nodeDefaults = withDefaults(spec.defaults.node, NODE_DEFAULTS);
  const edgeDefaults = withDefaults(spec.defaults.edge, EDGE_DEFAULTS);
  return {
    title: spec.title,
    layout: spec.layout,
    direction: spec.direction,
    spacing: { nodes: spec.spacing.nodes ?? 60, layers: spec.spacing.layers ?? 110 },
    font: nodeDefaults.font,
    nodes: spec.nodes.map((node) => ({
      ...node,
      ...withDefaults(node, nodeDefaults),
      labelColor: node.labelColor ?? spec.defaults.node.labelColor,
    })),
    edges: spec.edges.map((edge) => ({
      ...edge,
      ...withDefaults(edge, edgeDefaults),
      labelColor: edge.labelColor ?? spec.defaults.edge.labelColor,
    })),
    groups: spec.groups.map((group) => ({
      ...group,
      name: group.name ?? group.id,
      color: group.color ?? "grey",
    })),
  };
}

/** Parses a spec. Throws an error with a readable list of the problems if the spec is not valid. */
export function parseSpec(zod: Zod, json: unknown): Diagram {
  const result = makeSpecSchema(zod).safeParse(json);
  if (!result.success) throw new Error(zod.prettifyError(result.error));
  return resolveSpec(result.data);
}
