---
name: tldraw
description:
  Creates hand-drawn-style diagrams (architecture sketches, flowcharts, pipelines, boxes and arrows)
  as tldraw ".tldr" files, with PNG or SVG exports. Positions the nodes automatically. Use when
  asked to draw, sketch, or diagram something, to make a diagram image, or to export or open an
  existing .tldr file.
---

Write a JSON spec of nodes and edges. One command positions the nodes, draws them in the real tldraw
editor, and writes a `.tldr` file and an image. You do not calculate coordinates.

## Requirements

- `bun` on `PATH`.
- The first run installs tldraw-cli, elkjs, and zod into `~/.cache/tldraw-diagram-skill/` (up to 30
  seconds). If puppeteer has no Chrome yet, it also downloads Chrome (about 1 minute). Later runs
  take 3 to 5 seconds.

## Workflow

1. Write a spec, for example `diagram.json`. See the format and the recipes below.
2. Run the script from this skill's directory:

   ```bash
   bun <skill-dir>/scripts/diagram.ts diagram.json --png
   ```

   The script writes `diagram.tldr` and `diagram.png` next to the spec, and writes their paths to
   stdout. Use `--svg` for SVG, `--dark` for the dark theme, `--transparent` for no background, and
   `-o out.tldr` for a different path.

3. **Look at the PNG.** Read the image and check it: are labels readable? Do arrows cross nodes? Is
   the flow direction clear? Change the spec and run the script again. Do this until the diagram
   looks good.

If the spec is not valid, the script lists each problem with its path (for example
`edges[3].to: unknown node or group "db"`) and exits with status 1.

## Spec format

```json
{
  "title": "Checkout architecture",
  "direction": "right",
  "defaults": { "node": { "fill": "solid" } },
  "groups": [{ "id": "backend", "name": "Backend", "color": "violet" }],
  "nodes": [
    { "id": "browser", "text": "Browser", "color": "blue" },
    {
      "id": "api",
      "text": "**API gateway**\nauth, rate limits",
      "color": "violet",
      "group": "backend"
    },
    { "id": "orders", "text": "Orders service", "color": "violet", "group": "backend" },
    { "id": "db", "text": "Postgres", "shape": "ellipse", "color": "green" }
  ],
  "edges": [
    { "from": "browser", "to": "api", "text": "HTTPS" },
    { "from": "api", "to": "orders" },
    { "from": "orders", "to": "db", "text": "SQL" }
  ]
}
```

### Top level

| Field       | Values                                            | Default  |
| ----------- | ------------------------------------------------- | -------- |
| `title`     | text above the diagram                            | none     |
| `direction` | `right` `down` `left` `up`                        | `right`  |
| `layout`    | `auto` (ELK positions the nodes) or `manual`      | `auto`   |
| `spacing`   | `{ "nodes": 60, "layers": 110 }` in canvas units  | as shown |
| `defaults`  | `{ "node": {...}, "edge": {...} }` style defaults | none     |
| `nodes`     | list of nodes (at least one)                      | required |
| `edges`     | list of edges                                     | `[]`     |
| `groups`    | list of groups                                    | `[]`     |

### Nodes

| Field        | Values                                                                  | Default     |
| ------------ | ----------------------------------------------------------------------- | ----------- |
| `id`         | unique text                                                             | required    |
| `text`       | the label (see "Text")                                                  | `""`        |
| `shape`      | a geo shape, `note` (sticky note), or `text` (text with no box)         | `rectangle` |
| `color`      | a color (see "Styles")                                                  | `black`     |
| `fill`       | `none` `semi` `solid` `pattern` `fill` `lined-fill`                     | `none`      |
| `dash`       | `draw` `solid` `dashed` `dotted`                                        | `draw`      |
| `size`       | `s` `m` `l` `xl` (text size and line weight)                            | `m`         |
| `font`       | `draw` (hand-drawn) `sans` `serif` `mono`                               | `draw`      |
| `labelColor` | a color                                                                 | `black`     |
| `align`      | `start` `middle` `end` (also `verticalAlign`)                           | `middle`    |
| `group`      | the `id` of a group                                                     | none        |
| `w`, `h`     | a fixed size. Usually omit them: the script sizes each node to its text | automatic   |
| `x`, `y`     | the center of the node. Only for `"layout": "manual"`                   | none        |

Geo shapes: `rectangle` `ellipse` `oval` `diamond` `hexagon` `octagon` `pentagon` `triangle` `cloud`
`star` `heart` `rhombus` `rhombus-2` `trapezoid` `x-box` `check-box` `arrow-right` `arrow-left`
`arrow-up` `arrow-down`. Aliases: `rect` `box` `square` → `rectangle`, `circle` → `ellipse`, `pill`
→ `oval`, `decision` → `diamond`, `sticky` → `note`, `label` → `text`.

### Edges

| Field                            | Values                                                                     | Default         |
| -------------------------------- | -------------------------------------------------------------------------- | --------------- |
| `from`, `to`                     | the `id` of a node **or a group**                                          | required        |
| `text`                           | the label                                                                  | `""`            |
| `route`                          | `curved` (follows the layout), `straight`, `elbow` (right angles)          | `curved`        |
| `color`, `dash`, `size`, `font`  | as for nodes                                                               | as nodes        |
| `labelColor`                     | a color                                                                    | `color`         |
| `arrowheadStart`, `arrowheadEnd` | `none` `arrow` `triangle` `square` `dot` `pipe` `diamond` `inverted` `bar` | `none`, `arrow` |
| `bend`                           | a fixed curve in canvas units. Usually omit it                             | automatic       |
| `labelPosition`                  | 0 to 1 along the arrow                                                     | `0.5`           |

### Groups

`{ "id": "backend", "name": "Backend", "color": "violet", "group": "outer" }`. A group is a dashed
box with its name at the top left. The layout keeps the members of a group together. Groups can be
in other groups (`group`). `name` is the `id` if you omit it. `color` is `grey` if you omit it.

### Styles

- Colors: `black` `grey` `light-violet` `violet` `blue` `light-blue` `yellow` `orange` `green`
  `light-green` `light-red` `red` `white`.
- `fill: "solid"` gives a light tint of the color. Use it for most nodes.
- `fill: "fill"` gives the full color. Use it for one or two nodes that must stand out. Keep
  `labelColor` black: tldraw puts a light outline on label text, so white labels look blurred.
- `fill: "semi"` is white, and `none` is transparent.

### Text

Use `\n` for a new line, `- ` at the start of a line for a bullet, `**bold**`, `*italic*`, and
`` `code` ``. The script makes each node wide enough for its longest line, up to a maximum width.
Longer lines wrap, and the node gets taller.

## How to make diagrams look good

- **Put the nodes in reading order.** The layout uses the order of `nodes` to break cycles and to
  sort nodes in a layer. Put the entry point first.
- **Give colors a meaning, and use them the same way in all diagrams.** For example: blue for
  clients, violet for services, green for data stores, orange for queues and async work, grey for
  external systems, red for failure paths.
- **Use dashes with a meaning:** `dashed` for async or optional flows, `dotted` for notes and weak
  links.
- **Keep edge labels short** (one to three words). A long label makes the gap between layers wider.
- **Use groups** for a subsystem, a network boundary, or a team. Draw an edge to a group when the
  target is "any member".
- **Keep a diagram to about 15 nodes.** Make two diagrams if you need more.
- For a long chain, use `"direction": "down"`. A wide PNG is hard to read.
- Use `route: "elbow"` only for edges between next layers, for example in a tree. tldraw makes an
  elbow route around its two ends only, so a long elbow edge can go through other nodes. The default
  `curved` route follows the ELK route and goes around nodes.
- Put a `note` next to a node for a comment, and connect them with a `dotted`, `grey` edge that has
  `"arrowheadEnd": "none"`.

## Recipes

Flowchart (top to bottom, with a decision and a loop):

```json
{
  "direction": "down",
  "defaults": { "node": { "fill": "solid", "color": "blue" } },
  "nodes": [
    { "id": "start", "text": "Push to `main`", "shape": "pill", "color": "grey" },
    { "id": "ci", "text": "Run CI\n- lint\n- tests", "align": "start" },
    { "id": "ok", "text": "All green?", "shape": "diamond", "color": "yellow" },
    { "id": "fix", "text": "Fix and push again", "color": "red" },
    { "id": "ship", "text": "Deploy", "color": "green", "fill": "fill" }
  ],
  "edges": [
    { "from": "start", "to": "ci" },
    { "from": "ci", "to": "ok" },
    { "from": "ok", "to": "ship", "text": "yes", "color": "green" },
    { "from": "ok", "to": "fix", "text": "no", "color": "red" },
    { "from": "fix", "to": "ci", "dash": "dashed" }
  ]
}
```

Free layout (a matrix, a timeline, or a mind map): set `"layout": "manual"` and give each node `x`
and `y` (its center). Groups fit around their members. Edges still bind to the nodes.

## Existing .tldr files

A `.tldr` file is JSON. It opens in the tldraw editor. You can change a label or a color directly in
the file. For a structural change, change the spec and build again. Keep the spec next to the
`.tldr` file.

tldraw-cli (<https://github.com/kitschpatrol/tldraw-cli>) exports and opens `.tldr` files that you
did not make with this script:

```bash
bunx @kitschpatrol/tldraw-cli export sketch.tldr --format png --output ./images
bunx @kitschpatrol/tldraw-cli export sketch.tldr --frames   # one image for each frame
bunx @kitschpatrol/tldraw-cli export sketch.tldr --pages    # one image for each page
bunx @kitschpatrol/tldraw-cli open sketch.tldr --local      # edit in a local editor
```

- `open` without `--local` **uploads the sketch to tldraw.com**. Ask the user first.
- `tldraw export` fits the sketch into a small window. For a large sketch, the zoom goes below 0.25,
  and tldraw then draws dashed lines as solid lines. `diagram.ts` does not have this problem,
  because it exports at a zoom of 1.
