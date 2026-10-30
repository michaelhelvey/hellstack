import { describe, expect, test } from "bun:test";

import { render } from "pele";

import { kittyImage } from "../skills/statechart/scripts/lib/kitty.ts";
import { applyTheme, themes } from "../skills/statechart/scripts/lib/theme.ts";

const chart = `stateDiagram-v2
    [*] --> Idle
    Idle --> Fetching : you press fetch
    Fetching --> Failure : the connect fails
    state Online {
        [*] --> Syncing
    }
    Failure --> Online : you press retry
    class Idle blue
    class Failure teal
    class Failure breaks
    classDef breaks fill:#ffecee,stroke:#e72e3b,color:#cd2834
`;

const dark = themes.dark;
const svg = applyTheme(render(chart, { responsive: false }).svg, dark, "Arial", 20);

function node(id: string): string {
  const match = new RegExp(`<g class="pele-node[^"]*" data-id="${id}"[^>]*>.*?</g>`).exec(svg);
  if (!match) throw new Error(`no node ${id}`);
  return match[0];
}

describe("applyTheme", () => {
  test("replaces every Pele color variable with a theme color", () => {
    expect(svg).not.toContain("var(--_");
    expect(svg).toContain(`fill="${dark.palette.bg}"`);
  });

  test("gives a state the fill of its group class", () => {
    expect(node("Idle")).toContain(`fill="${dark.groups.blue}"`);
  });

  test("gives a state with no class the surface color", () => {
    expect(node("Fetching")).toContain(`fill="${dark.palette.s}"`);
  });

  test("shows a mark over the group color and removes the classDef style", () => {
    const failure = node("Failure");
    const mark = dark.marks.breaks!;
    expect(failure).toContain(`fill="${mark.fill}"`);
    expect(failure).toContain(`stroke="${mark.stroke}" stroke-width="2.5"`);
    expect(failure).toContain(`fill="${mark.text}"`);
    expect(failure).not.toContain("style=");
  });

  test("themes states in parent states", () => {
    expect(node("Syncing")).toContain(`fill="${dark.palette.s}"`);
  });

  test("sets the font as attributes on the root", () => {
    expect(svg).toStartWith('<svg font-size="20" font-family="Arial" ');
  });
});

describe("kittyImage", () => {
  const png = new Uint8Array(10_000).map((_, i) => i % 251);
  const escapes = kittyImage(png, 42)
    .split("\x1b\\")
    .filter(Boolean)
    .map((escape) => [escape, ...escape.replace("\x1b_G", "").split(";")]);

  test("sends the data in chunks that join to the image", () => {
    expect(escapes.length).toBeGreaterThan(1);
    expect(escapes.every(([, , data]) => data!.length <= 4096)).toBe(true);
    const joined = escapes.map(([, , data]) => data).join("");
    expect(Buffer.from(joined, "base64")).toEqual(Buffer.from(png));
  });

  test("puts the size on the first chunk and ends with m=0", () => {
    expect(escapes[0]![1]).toBe("a=T,f=100,c=42,m=1");
    expect(escapes.slice(1, -1).every(([, keys]) => keys === "m=1")).toBe(true);
    expect(escapes.at(-1)![1]).toBe("m=0");
  });
});
