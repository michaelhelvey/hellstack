import path from "node:path";

import { Theme } from "@earendil-works/pi-coding-agent";
import { z } from "zod";

type ThemeArgs = ConstructorParameters<typeof Theme>;

const ThemeFileSchema = z.object({ colors: z.record(z.string(), z.unknown()) });

/**
 * Makes a theme with the tokens of the built-in dark theme. Each foreground token gets a different
 * gray, so that tests can see that the text has a color.
 */
export async function testTheme(): Promise<Theme> {
  const entry = Bun.fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  const file = path.join(path.dirname(entry), "modes/interactive/theme/dark.json");
  const tokens = Object.keys(ThemeFileSchema.parse(await Bun.file(file).json()).colors);
  const fg = Object.fromEntries(tokens.filter((t) => !t.endsWith("Bg")).map((t) => [t, "#a0a0a0"]));
  const bg = Object.fromEntries(tokens.filter((t) => t.endsWith("Bg")).map((t) => [t, "#202020"]));

  return new Theme(fg as ThemeArgs[0], bg as ThemeArgs[1], "truecolor");
}
