import { z } from "zod";

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

function styleSchemas() {
  const color = z.enum(COLORS);
  const dash = z.enum(["draw", "solid", "dashed", "dotted"]);
  const size = z.enum(["s", "m", "l", "xl"]);
  const font = z.enum(["draw", "sans", "serif", "mono"]);
  const align = z.enum(["start", "middle", "end"]);
  const shape = z.preprocess(
    (value) => (typeof value === "string" ? (SHAPE_ALIASES[value] ?? value) : value),
    z.enum([...GEOS, "note", "text"]),
  );
  const node = {
    shape: shape.optional(),
    color: color.optional(),
    labelColor: color.optional(),
    fill: z.enum(["none", "semi", "solid", "pattern", "fill", "lined-fill"]).optional(),
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
    route: z.enum(["curved", "straight", "elbow"]).optional(),
    arrowheadStart: z.enum(ARROWHEADS).optional(),
    arrowheadEnd: z.enum(ARROWHEADS).optional(),
  };
  return { color, node, edge };
}

function baseSchema() {
  const style = styleSchemas();
  const node = z.strictObject({
    id: z.string().min(1),
    text: z.string().default(""),
    ...style.node,
    w: z.number().positive().optional(),
    h: z.number().positive().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    group: z.string().optional(),
  });
  const edge = z.strictObject({
    from: z.string(),
    to: z.string(),
    text: z.string().default(""),
    ...style.edge,
    bend: z.number().optional(),
    labelPosition: z.number().min(0).max(1).optional(),
  });
  const group = z.strictObject({
    id: z.string().min(1),
    name: z.string().optional(),
    color: style.color.optional(),
    group: z.string().optional(),
  });
  return z.strictObject({
    $schema: z.string().optional(),
    title: z.string().optional(),
    layout: z.enum(["auto", "manual"]).default("auto"),
    direction: z.enum(DIRECTIONS).default("right"),
    spacing: z
      .strictObject({
        nodes: z.number().min(0).optional(),
        layers: z.number().min(0).optional(),
      })
      .default({}),
    defaults: z
      .strictObject({
        node: z.strictObject(style.node).default({}),
        edge: z.strictObject(style.edge).default({}),
      })
      .default({ node: {}, edge: {} }),
    nodes: z.array(node).min(1),
    edges: z.array(edge).default([]),
    groups: z.array(group).default([]),
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

/** The zod schema for a diagram spec. */
export const specSchema = baseSchema().superRefine(checkReferences);

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
export function parseSpec(json: unknown): Diagram {
  const result = specSchema.safeParse(json);
  if (!result.success) throw new Error(z.prettifyError(result.error));
  return resolveSpec(result.data);
}
