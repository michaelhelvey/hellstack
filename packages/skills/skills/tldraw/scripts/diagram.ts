#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadDependencies, type Dependencies } from "./lib/deps.ts";
import { openEditor, type EditorSession, type ImageOptions } from "./lib/editor.ts";
import {
  autoLayout,
  drawPlan,
  manualLayout,
  planNodeSize,
  type Layout,
  type Size,
} from "./lib/layout.ts";
import { parseSpec, type Diagram } from "./lib/spec.ts";

const USAGE = `Usage: bun diagram.ts <spec.json> [options]

Builds a tldraw .tldr file from a JSON spec, and exports images of it.

Options:
  -o, --out <file.tldr>   Output path (default: the spec path with .tldr)
      --png               Also write a PNG next to the .tldr file
      --svg               Also write an SVG next to the .tldr file
      --dark              Export images in the dark theme
      --transparent       Export images without a background
      --scale <n>         Pixel ratio of the PNG (default: 2)
      --padding <n>       Space around the image, in canvas units (default: 32)
  -h, --help              Show this help

The script writes the path of each file that it makes to stdout, one on each line.`;

interface Options {
  specPath: string;
  out: string;
  formats: ImageOptions["format"][];
  image: Omit<ImageOptions, "format">;
}

function optionalNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`--${name} must be a number`);
  return number;
}

function readOptions(argv: string[]): Options {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      png: { type: "boolean", default: false },
      svg: { type: "boolean", default: false },
      dark: { type: "boolean", default: false },
      transparent: { type: "boolean", default: false },
      scale: { type: "string" },
      padding: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [spec] = positionals;
  if (values.help || spec === undefined || positionals.length > 1) {
    console.error(USAGE);
    process.exit(values.help ? 0 : 2);
  }
  const specPath = resolve(spec);
  return {
    specPath,
    out: resolve(values.out ?? `${specPath.replace(/\.json$/i, "")}.tldr`),
    formats: (["png", "svg"] as const).filter((format) => values[format]),
    image: {
      dark: values.dark,
      transparent: values.transparent,
      scale: optionalNumber(values.scale, "scale"),
      padding: optionalNumber(values.padding, "padding"),
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readDiagram(deps: Dependencies, file: string): Promise<Diagram> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${messageOf(error)}`, { cause: error });
  }
  try {
    return parseSpec(deps.z, json);
  } catch (error) {
    throw new Error(`The spec ${file} is not valid:\n${messageOf(error)}`, { cause: error });
  }
}

function padLabel(size: Size): Size {
  return { w: Math.ceil(size.w) + 24, h: Math.ceil(size.h) + 8 };
}

async function sizeDiagram(session: EditorSession, diagram: Diagram): Promise<Diagram> {
  const items = diagram.nodes.map((node) => ({
    text: node.text || " ",
    font: node.font,
    size: node.size,
  }));
  const textSizes = await session.api("measureText", items);
  const planned = diagram.nodes.map((node, i) => ({
    ...node,
    ...planNodeSize(node, textSizes[i]?.w ?? 0),
  }));
  const measured = await session.api("measureNodes", planned);
  return { ...diagram, nodes: planned.map((node, i) => ({ ...node, ...measured[i] })) };
}

async function layOut(
  deps: Dependencies,
  session: EditorSession,
  diagram: Diagram,
): Promise<Layout> {
  const sizes = new Map(diagram.nodes.map((node) => [node.id, { w: node.w ?? 0, h: node.h ?? 0 }]));
  if (diagram.layout === "manual") return manualLayout(diagram, sizes);
  const labels = diagram.edges.map((edge) => ({
    text: edge.text || " ",
    font: edge.font,
    size: edge.size,
  }));
  const labelSizes = (await session.api("measureText", labels)).map(padLabel);
  return autoLayout(deps.createElk(), diagram, sizes, labelSizes);
}

async function writeImages(session: EditorSession, options: Options): Promise<string[]> {
  const paths: string[] = [];
  for (const format of options.formats) {
    const file = join(dirname(options.out), `${basename(options.out, ".tldr")}.${format}`);
    const base64 = await session.api("exportImage", { format, ...options.image });
    await writeFile(file, Buffer.from(base64, "base64"));
    paths.push(file);
  }
  return paths;
}

async function run(options: Options): Promise<string[]> {
  const deps = await loadDependencies();
  const spec = await readDiagram(deps, options.specPath);
  const session = await openEditor(deps.puppeteer, deps.tldrawAppDir);
  try {
    await session.api("loadFonts");
    const diagram = await sizeDiagram(session, spec);
    await session.api("draw", drawPlan(diagram, await layOut(deps, session, diagram)));
    await writeFile(options.out, await session.api("serialize"));
    return [options.out, ...(await writeImages(session, options))];
  } finally {
    await session.close();
  }
}

try {
  for (const file of await run(readOptions(process.argv.slice(2)))) console.log(file);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
