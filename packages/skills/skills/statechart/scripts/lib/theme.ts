/** The base colors of a theme. The keys are the short names that Pele uses in `var(--_<key>)`. */
export interface Palette {
  bg: string;
  fg: string;
  m: string;
  l: string;
  s: string;
  a: string;
  b: string;
  c: string;
}

/** The colors of a mark class. A mark shows over the color of a group. */
export interface Mark {
  fill?: string;
  stroke: string;
  text?: string;
}

/** A full theme: base colors, a fill for each group class, and the mark classes. */
export interface Theme {
  palette: Palette;
  groups: Record<string, string>;
  marks: Record<string, Mark>;
}

/** The themes that the script can use. */
export const themes: Record<"dark" | "light", Theme> = {
  dark: {
    palette: {
      bg: "#1f1f1f",
      fg: "#f5f5f5",
      m: "#acacac",
      l: "#939393",
      s: "#121212",
      a: "#2c2c2c",
      b: "#4e4e4e",
      c: "#5b7bd5",
    },
    groups: {
      blue: "#1b3857",
      orange: "#573117",
      purple: "#3c2e57",
      yellow: "#573d17",
      teal: "#174641",
      tan: "#3d3127",
      pink: "#57233e",
    },
    marks: {
      breaks: { fill: "#2e2021", stroke: "#cf2b35", text: "#ff6463" },
      mayBreak: { fill: "#2e2619", stroke: "#d0700f", text: "#ffa257" },
      bugPath: { stroke: "#116dd2" },
      repeats: { stroke: "#9a3fcf" },
    },
  },
  light: {
    palette: {
      bg: "#ffffff",
      fg: "#1c1c1c",
      m: "#656565",
      l: "#808080",
      s: "#fcfcfc",
      a: "#f1f1f1",
      b: "#c9c9c9",
      c: "#5b7bd5",
    },
    groups: {
      blue: "#c3e0ff",
      orange: "#f0d3bf",
      purple: "#e3d5ff",
      yellow: "#f0dcbf",
      teal: "#bfe3df",
      tan: "#e5d9ce",
      pink: "#ffcbe6",
    },
    marks: {
      breaks: { fill: "#ffecee", stroke: "#e72e3b", text: "#cd2834" },
      mayBreak: { fill: "#fff3e6", stroke: "#e8730c", text: "#b85a06" },
      bugPath: { stroke: "#1680f3" },
      repeats: { stroke: "#9b35d6" },
    },
  },
};

const NODE =
  /<g class="pele-node pele-state((?: [^"]*)?)"([^>]*)><rect([^>]*?)(?: style="[^"]*")?\/><text([^>]*?)(?: style="[^"]*")?( x=[^>]*)>/g;

interface NodeColors {
  fill: string;
  stroke: string;
  strokeWidth: string;
  text: string;
}

function nodeColors(classes: string[], theme: Theme): NodeColors {
  const colors = {
    fill: theme.palette.s,
    stroke: theme.palette.b,
    strokeWidth: "1",
    text: theme.palette.fg,
  };
  for (const name of classes) {
    const group = theme.groups[name];
    if (group) colors.fill = group;
  }
  for (const name of classes) {
    const mark = theme.marks[name];
    if (!mark) continue;
    colors.fill = mark.fill ?? colors.fill;
    colors.text = mark.text ?? colors.text;
    colors.stroke = mark.stroke;
    colors.strokeWidth = "2.5";
  }
  return colors;
}

/**
 * Makes a Pele SVG show correctly in a renderer that has no CSS variables, such as resvg.
 *
 * Pele sets all colors with CSS variables and the fonts with the CSS `font` shorthand. This
 * function writes the colors of `theme` and the fonts as plain attributes. It gives each state the
 * fill of its group class and the colors of its mark classes. It removes the `style` attribute that
 * a Mermaid `classDef` adds, because that style is for one theme only.
 */
export function applyTheme(
  svg: string,
  theme: Theme,
  fontFamily: string,
  fontSize: number,
): string {
  const palette = theme.palette;
  return svg
    .replace(/var\(--_(\w+)\)/g, (match, key: string) => palette[key as keyof Palette] ?? match)
    .replace(/var\(--pele-font,sans-serif\)/g, fontFamily)
    .replace(/^<svg /, `<svg font-size="${fontSize}" font-family="${fontFamily}" `)
    .replace(
      NODE,
      (
        _match,
        classList: string,
        gAttrs: string,
        rect: string,
        textStart: string,
        textEnd: string,
      ) => {
        const colors = nodeColors(classList.trim().split(/\s+/), theme);
        const themedRect = rect
          .replace(/fill="[^"]*"/, `fill="${colors.fill}"`)
          .replace(
            /stroke="[^"]*"/,
            `stroke="${colors.stroke}" stroke-width="${colors.strokeWidth}"`,
          );
        return `<g class="pele-node pele-state${classList}"${gAttrs}><rect${themedRect}/><text${textStart} fill="${colors.text}"${textEnd}>`;
      },
    );
}
