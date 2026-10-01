import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** The packages that the script installs at run time, with exact versions. */
export const DEPENDENCIES = {
  oxlint: "1.78.0",
  "@stylistic/eslint-plugin": "5.10.0",
} as const;

/** The paths of the installed packages. */
export interface Dependencies {
  /** The oxlint CLI script. */
  oxlint: string;
  /** The entry module of `@stylistic/eslint-plugin`. */
  stylistic: string;
}

function cacheDirectory(): string {
  const hash = createHash("sha256").update(JSON.stringify(DEPENDENCIES)).digest("hex").slice(0, 12);
  const root = process.env["XDG_CACHE_HOME"] || join(homedir(), ".cache");

  return join(root, "whitespace-skill", hash);
}

async function install(dir: string, marker: string): Promise<void> {
  console.error(`Installing oxlint and @stylistic/eslint-plugin into ${dir} (first run only)...`);
  await mkdir(dir, { recursive: true });

  const manifest = { private: true, type: "module", dependencies: DEPENDENCIES };

  await writeFile(join(dir, "package.json"), JSON.stringify(manifest, null, 2));

  const proc = Bun.spawn([process.execPath, "install"], {
    cwd: dir,
    stdio: ["ignore", "inherit", "inherit"],
  });

  if ((await proc.exited) !== 0) throw new Error(`bun install failed in ${dir}`);

  await writeFile(marker, "");
}

/** Installs the dependencies into a cache directory on the first run, then gives their paths. */
export async function loadDependencies(): Promise<Dependencies> {
  const dir = cacheDirectory();
  const marker = join(dir, ".installed");

  if (!existsSync(marker)) await install(dir, marker);

  return {
    oxlint: join(dir, "node_modules", "oxlint", "bin", "oxlint"),
    stylistic: Bun.resolveSync("@stylistic/eslint-plugin", dir),
  };
}
