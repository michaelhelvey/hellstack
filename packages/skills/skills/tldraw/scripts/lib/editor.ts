/// <reference lib="dom" />
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve, sep } from "node:path";

import type { PuppeteerNode } from "puppeteer-core";
import type { Editor, TLRichText, TLShapeId } from "tldraw";

import type { DrawPlan, PlacedNode, Size } from "./layout.ts";
import type { DiagramNode } from "./spec.ts";

declare global {
  var editor: Editor;
  var diagram: BrowserApi;
}

/** Text to measure in the font and size that tldraw draws it with. */
export interface TextItem {
  text: string;
  font: DiagramNode["font"];
  size: DiagramNode["size"];
}

/** A node with the size that `planNodeSize` gave it. */
export type SizedNode = DiagramNode & Size;

/** Options for an image export. */
export interface ImageOptions {
  format: "png" | "svg";
  dark: boolean;
  transparent: boolean;
  scale: number | undefined;
  padding: number | undefined;
}

/** The functions that `installBrowserApi` adds to the page. */
export interface BrowserApi {
  loadFonts(): Promise<void>;
  measureText(items: TextItem[]): Size[];
  measureNodes(nodes: SizedNode[]): Size[];
  draw(plan: DrawPlan): void;
  serialize(): string;
  exportImage(options: ImageOptions): Promise<string>;
}

/** A tldraw editor in a headless browser. */
export interface EditorSession {
  api: <K extends keyof BrowserApi>(
    name: K,
    ...args: Parameters<BrowserApi[K]>
  ) => Promise<Awaited<ReturnType<BrowserApi[K]>>>;
  close(): Promise<void>;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function serveDirectory(dir: string): Promise<Server> {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const file = join(root, pathname === "/" ? "index.html" : decodeURIComponent(pathname));
    const type = CONTENT_TYPES[extname(file)] ?? "application/octet-stream";
    const body = file.startsWith(root + sep)
      ? readFile(file)
      : Promise.reject(new Error("outside root"));
    body.then(
      (data) => res.writeHead(200, { "content-type": type }).end(data),
      () => res.writeHead(404).end(),
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return server;
}

/** Opens the tldraw app that tldraw-cli contains, and adds the functions of `BrowserApi` to it. */
export async function openEditor(puppeteer: PuppeteerNode, appDir: string): Promise<EditorSession> {
  const server = await serveDirectory(appDir);
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const { port } = server.address() as AddressInfo;
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => globalThis.editor !== undefined);
    await page.evaluate(installBrowserApi);
    return {
      api: (name, ...args) =>
        page.evaluate(
          (n, a) => (globalThis.diagram[n] as (...x: unknown[]) => unknown)(...a),
          name,
          args,
        ) as never,
      close: async () => {
        await browser.close();
        server.close();
      },
    };
  } catch (error) {
    await browser.close();
    server.close();
    throw error;
  }
}

// This function runs in the browser page. It must not use values from outside its body.
function installBrowserApi(): void {
  const editor = globalThis.editor;
  type RichNode = { type: string; text?: string; marks?: { type: string }[]; content?: RichNode[] };

  function mark(token: string): RichNode {
    if (token.startsWith("**"))
      return { type: "text", text: token.slice(2, -2), marks: [{ type: "bold" }] };
    if (token.startsWith("`"))
      return { type: "text", text: token.slice(1, -1), marks: [{ type: "code" }] };
    return { type: "text", text: token.slice(1, -1), marks: [{ type: "italic" }] };
  }

  function inline(text: string): RichNode[] {
    const parts: RichNode[] = [];
    let last = 0;
    for (const match of text.matchAll(/\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*/g)) {
      if (match.index > last) parts.push({ type: "text", text: text.slice(last, match.index) });
      parts.push(mark(match[0]));
      last = match.index + match[0].length;
    }
    if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
    return parts;
  }

  function paragraph(line: string): RichNode {
    return line === "" ? { type: "paragraph" } : { type: "paragraph", content: inline(line) };
  }

  function richText(text: string): TLRichText {
    const content: RichNode[] = [];
    for (const line of text.split("\n")) {
      const bullet = /^[-•] (.*)$/.exec(line);
      const item = { type: "listItem", content: [paragraph(bullet?.[1] ?? "")] };
      const list = content.at(-1);
      if (!bullet) content.push(paragraph(line));
      else if (list?.type === "bulletList") list.content?.push(item);
      else content.push({ type: "bulletList", content: [item] });
    }
    return { type: "doc", content };
  }

  function shapeId(id: string): TLShapeId {
    return `shape:${id}` as TLShapeId;
  }

  function createNode(
    id: TLShapeId,
    node: SizedNode & { x?: number | undefined; y?: number | undefined },
  ): void {
    const label = {
      richText: richText(node.text),
      font: node.font,
      size: node.size,
      color: node.color,
    };
    const position = { x: node.x ?? 0, y: node.y ?? 0 };
    const labelStyle = {
      labelColor: node.labelColor ?? "black",
      align: node.align,
      verticalAlign: node.verticalAlign,
    };
    if (node.shape === "text") {
      editor.createShape({ id, type: "text", ...position, props: label });
    } else if (node.shape === "note") {
      editor.createShape({ id, type: "note", ...position, props: { ...label, ...labelStyle } });
    } else {
      const geo = { geo: node.shape, w: node.w, h: node.h, fill: node.fill, dash: node.dash };
      editor.createShape({
        id,
        type: "geo",
        ...position,
        props: { ...label, ...labelStyle, ...geo },
      });
    }
  }

  function measureText(item: TextItem): Size {
    const id = shapeId(`measure-${Math.random().toString(36).slice(2)}`);
    const props = {
      richText: richText(item.text),
      font: item.font,
      size: item.size,
      autoSize: true,
    };
    editor.createShape({ id, type: "text", props });
    const bounds = editor.getShapePageBounds(id);
    editor.deleteShape(id);
    return { w: bounds?.w ?? 0, h: bounds?.h ?? 0 };
  }

  function drawGroups(plan: DrawPlan): void {
    for (const group of plan.groups) {
      editor.createShape({
        id: shapeId(group.id),
        type: "geo",
        x: group.x,
        y: group.y,
        props: {
          geo: "rectangle",
          w: group.w,
          h: group.h,
          richText: richText(`**${group.name}**`),
          color: group.color,
          labelColor: group.color,
          fill: "semi",
          dash: "dashed",
          size: "s",
          font: group.font,
          align: "start",
          verticalAlign: "start",
        },
      });
    }
  }

  function drawEdges(plan: DrawPlan): void {
    plan.edges.forEach((edge, i) => {
      const id = shapeId(`edge-${i}`);
      editor.createShape({
        id,
        type: "arrow",
        x: edge.start.x,
        y: edge.start.y,
        props: {
          kind: edge.route === "elbow" ? "elbow" : "arc",
          start: { x: 0, y: 0 },
          end: { x: edge.end.x - edge.start.x, y: edge.end.y - edge.start.y },
          bend: edge.bend,
          richText: richText(edge.text),
          labelPosition: edge.labelPosition,
          color: edge.color,
          labelColor: edge.labelColor ?? edge.color,
          dash: edge.dash,
          size: edge.size,
          font: edge.font,
          arrowheadStart: edge.arrowheadStart,
          arrowheadEnd: edge.arrowheadEnd,
        },
      });
      editor.createBindings(
        (["start", "end"] as const).map((terminal) => ({
          type: "arrow",
          fromId: id,
          toId: shapeId(terminal === "start" ? edge.from : edge.to),
          props: {
            terminal,
            normalizedAnchor: { x: 0.5, y: 0.5 },
            isExact: false,
            isPrecise: false,
            snap: "none",
          },
        })),
      );
    });
  }

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((done, fail) => {
      const reader = new FileReader();
      reader.onload = () => {
        const url = typeof reader.result === "string" ? reader.result : "";
        done(url.slice(url.indexOf(",") + 1));
      };
      reader.onerror = () => fail(new Error("Cannot read the image", { cause: reader.error }));
      reader.readAsDataURL(blob);
    });
  }

  globalThis.diagram = {
    async loadFonts() {
      const ids = (["draw", "sans", "serif", "mono"] as const).map((font) => {
        const id = shapeId(`font-${font}`);
        editor.createShape({
          id,
          type: "text",
          props: { richText: richText("Aa **Bb** *Cc* `Dd`"), font },
        });
        return id;
      });
      await editor.fonts.loadRequiredFontsForCurrentPage(Infinity);
      await document.fonts.ready;
      editor.deleteShapes(ids);
    },

    measureText: (items) => items.map(measureText),

    measureNodes(nodes) {
      return nodes.map((node) => {
        const id = shapeId(`probe-${node.id}`);
        createNode(id, node);
        const bounds = editor.getShapePageBounds(id);
        editor.deleteShape(id);
        return { w: Math.ceil(bounds?.w ?? node.w), h: Math.ceil(bounds?.h ?? node.h) };
      });
    },

    draw(plan) {
      drawGroups(plan);
      for (const node of plan.nodes satisfies PlacedNode[]) createNode(shapeId(node.id), node);
      drawEdges(plan);
      if (plan.title) {
        const { text, x, y, font } = plan.title;
        const props = { richText: richText(text), size: "xl" as const, font };
        editor.createShape({ id: shapeId("diagram-title"), type: "text", x, y, props });
      }
    },

    // The same data as `serializeTldrawJson` in tldraw, without asset handling.
    serialize() {
      const { store } = editor;
      const records = store.allRecords().filter((r) => store.scopedTypes.document.has(r.typeName));
      return JSON.stringify({
        tldrawFileFormatVersion: 1,
        schema: store.schema.serialize(),
        records,
      });
    },

    // tldraw draws dashes as solid lines below a zoom of 0.25, so export at a zoom of 1.
    async exportImage({ format, dark, transparent, scale, padding }) {
      editor.setCamera({ x: 0, y: 0, z: 1 });
      const ids = [...editor.getCurrentPageShapeIds()];
      const options = { format, darkMode: dark, background: !transparent };
      const { blob } = await editor.toImage(ids, {
        ...options,
        ...(scale === undefined ? {} : { pixelRatio: scale }),
        ...(padding === undefined ? {} : { padding }),
      });
      return blobToBase64(blob);
    },
  };
}
