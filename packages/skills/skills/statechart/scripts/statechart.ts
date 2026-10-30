#!/usr/bin/env bun
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { Resvg } from "@resvg/resvg-js";
import { PeleError, render } from "pele";

import { kittyImage } from "./lib/kitty.ts";
import { applyTheme, themes } from "./lib/theme.ts";

const USAGE = `Usage: bun statechart.ts <chart.mmd> [options]

Renders a Mermaid state diagram with Pele, and writes a PNG next to the .mmd file.

Options:
  -o, --out <file.png>    Output path (default: the .mmd path with .png)
      --show              Also show the image in this terminal (kitty graphics protocol)
      --light             Use the light theme (default: dark)
      --cols <n>          Width of the shown image, in terminal cells (default: fit the terminal)
      --max-width <px>    Width that Pele must fit the layout into. Below 640, Pele can turn a
                          left-to-right chart into a top-to-bottom chart. (default: fit the
                          terminal with --show, else no limit)
      --font-size <px>    Size of the labels (default: 20)
  -h, --help              Show this help

The script writes the path of the PNG to stdout.`;

const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";
const CELL_PX = 8;
const LIMITS = { limit: 1_000_000, outputLimit: 8_000_000, maxEdges: 10_000 };

interface Options {
  source: string;
  out: string;
  show: boolean;
  theme: keyof typeof themes;
  cols: number | undefined;
  maxWidth: number | undefined;
  fontSize: number;
}

function optionalNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0)
    throw new Error(`--${name} must be a positive number`);
  return number;
}

function readOptions(argv: string[]): Options {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      show: { type: "boolean", default: false },
      light: { type: "boolean", default: false },
      cols: { type: "string" },
      "max-width": { type: "string" },
      "font-size": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [source] = positionals;
  if (values.help || source === undefined || positionals.length > 1) {
    console.error(USAGE);
    process.exit(values.help ? 0 : 2);
  }
  const path = resolve(source);
  return {
    source: path,
    out: resolve(values.out ?? `${path.replace(/\.mmd$/i, "")}.png`),
    show: values.show,
    theme: values.light ? "light" : "dark",
    cols: optionalNumber(values.cols, "cols"),
    maxWidth: optionalNumber(values["max-width"], "max-width"),
    fontSize: optionalNumber(values["font-size"], "font-size") ?? 20,
  };
}

function terminalCols(options: Options): number | undefined {
  return options.show && process.stdout.columns ? process.stdout.columns - 2 : undefined;
}

function renderSvg(text: string, options: Options): { svg: string; width: number } {
  const base = { ...LIMITS, responsive: false, padding: 24, fontSize: options.fontSize };
  const first = render(text, options.maxWidth ? { ...base, maxWidth: options.maxWidth } : base);
  const room = terminalCols(options);
  if (options.maxWidth !== undefined || room === undefined || first.width <= room * CELL_PX) {
    return first;
  }
  return render(text, { ...base, maxWidth: room * CELL_PX });
}

function rasterize(svg: string, options: Options): Uint8Array {
  const theme = themes[options.theme];
  const themed = applyTheme(svg, theme, FONT, options.fontSize);
  return new Resvg(themed, {
    fitTo: { mode: "zoom", value: 2 },
    background: theme.palette.bg,
    font: { loadSystemFonts: true, defaultFontFamily: "Helvetica Neue" },
  })
    .render()
    .asPng();
}

async function run(options: Options): Promise<void> {
  const { svg, width } = renderSvg(await Bun.file(options.source).text(), options);
  const png = rasterize(svg, options);
  await writeFile(options.out, png);
  console.log(options.out);
  if (!options.show) return;
  const room = terminalCols(options) ?? 80;
  const cols = options.cols ?? Math.min(room, Math.ceil(width / CELL_PX));
  process.stdout.write(`${kittyImage(png, cols)}\n`);
}

try {
  await run(readOptions(process.argv.slice(2)));
} catch (error) {
  if (error instanceof PeleError) {
    console.error(`Pele cannot render the chart (${error.code}): ${error.message}`);
    if (error.snippet) console.error(error.snippet);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(1);
}
