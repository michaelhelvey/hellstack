import { z } from "zod";

const packageSourceSchema = z.union([z.string(), z.looseObject({ source: z.string() })]);

const settingsSchema = z.looseObject({
  packages: z.array(packageSourceSchema).optional(),
});

function sourceOf(entry: z.infer<typeof packageSourceSchema>): string {
  return typeof entry === "string" ? entry : entry.source;
}

/**
 * Adds a local package path to the `packages` list of a pi `settings.json` text. Pi does not load
 * packages from the agent directory, so the sync adds `@hellstack/pi` to the list this way. It
 * does not add the path a second time.
 */
export function addPiPackage(text: string, packageDir: string): string {
  const settings = settingsSchema.parse(JSON.parse(text));
  const packages = settings.packages ?? [];
  const next = packages.some((entry) => sourceOf(entry) === packageDir)
    ? packages
    : [...packages, packageDir];
  return `${JSON.stringify({ ...settings, packages: next }, null, 2)}\n`;
}
