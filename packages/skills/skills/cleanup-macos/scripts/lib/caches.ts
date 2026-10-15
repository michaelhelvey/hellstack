import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { emptyDirectory, exists, HOME, run, runLoud, totalDiskUsage } from "./fs.ts";

/** A cache of a tool. The tool downloads or makes the data again when it needs it. */
export interface ToolCache {
  /** The identifier to give to `clean.ts`. */
  id: string;
  description: string;
  /** What the user loses, or a different result from what the size tells. */
  note?: string | undefined;
  /** The directories that the cleanup removes or empties. The scan does not list them again. */
  paths: string[];
  /** Gives the bytes that the cleanup can free, or undefined when the cache is not on this Mac. */
  size(): Promise<number | undefined>;
  clean(): Promise<void>;
}

/** The directories whose subdirectories are app and tool caches. */
export const CACHE_ROOTS = [join(HOME, "Library", "Caches"), join(HOME, ".cache")];

async function existingPaths(paths: string[]): Promise<string[]> {
  const found = await Promise.all(paths.map(exists));

  return paths.filter((_, index) => found[index]);
}

async function pathSize(paths: string[]): Promise<number | undefined> {
  const present = await existingPaths(paths);

  return present.length === 0 ? undefined : totalDiskUsage(present);
}

function directoryCache(id: string, description: string, paths: string[], note?: string) {
  return {
    id,
    description,
    note,
    paths,
    size: () => pathSize(paths),
    clean: async () => {
      await Promise.all(paths.map(emptyDirectory));
    },
  } satisfies ToolCache;
}

function commandCache(cache: Omit<ToolCache, "size" | "clean">, command: string[]): ToolCache {
  return {
    ...cache,
    size: async () => (Bun.which(command[0] ?? "") ? pathSize(cache.paths) : undefined),
    clean: () => runLoud(command),
  };
}

let podmanUsage: Promise<Map<string, number> | undefined> | undefined;

async function readPodmanUsage(): Promise<Map<string, number> | undefined> {
  const format = "{{.Type}}\t{{.RawReclaimable}}";
  const { code, stdout } = await run(["podman", "system", "df", "--format", format]);

  if (code !== 0) return undefined;

  const rows = stdout
    .trim()
    .split("\n")
    .map((line) => line.split("\t"));

  return new Map(rows.map(([type = "", bytes = "0"]) => [type, Number(bytes)]));
}

async function podmanReclaimable(types: string[]): Promise<number | undefined> {
  podmanUsage ??= readPodmanUsage();

  const usage = await podmanUsage;

  return usage && types.reduce((sum, type) => sum + (usage.get(type) ?? 0), 0);
}

function podmanCaches(): ToolCache[] {
  return [
    {
      id: "podman",
      description: "Podman stopped containers, unused images, networks, and build cache",
      note: "Needs a running podman machine. Does not remove volumes.",
      paths: [],
      size: () => podmanReclaimable(["Images", "Containers"]),
      clean: () => runLoud(["podman", "system", "prune", "--all", "--force"]),
    },
    {
      id: "podman-volumes",
      description: "Podman volumes that no container uses",
      note: "DATA LOSS: volumes can hold local databases. Ask the user first.",
      paths: [],
      size: () => podmanReclaimable(["Local Volumes"]),
      clean: () => runLoud(["podman", "volume", "prune", "--force"]),
    },
  ];
}

const library = join(HOME, "Library");
const xcode = join(library, "Developer", "Xcode");

/** Gives the caches of the tools on this Mac. */
export function toolCaches(): ToolCache[] {
  return [
    commandCache(
      {
        id: "homebrew",
        description: "Homebrew downloads and old versions of formulae and casks",
        paths: [join(library, "Caches", "Homebrew")],
      },
      ["brew", "cleanup", "--prune=all", "-s"],
    ),
    directoryCache("npm", "npm package cache", [join(HOME, ".npm", "_cacache")]),
    commandCache(
      {
        id: "pnpm",
        description: "pnpm content-addressable store",
        note: "Prune removes only the packages that no project uses, so it frees less than the size.",
        paths: [join(library, "pnpm", "store")],
      },
      ["pnpm", "store", "prune"],
    ),
    directoryCache("yarn", "Yarn package cache", [join(library, "Caches", "Yarn")]),
    directoryCache("bun", "Bun package cache", [join(HOME, ".bun", "install", "cache")]),
    commandCache(
      { id: "uv", description: "uv package cache", paths: [join(HOME, ".cache", "uv")] },
      ["uv", "cache", "clean"],
    ),
    directoryCache("cargo", "Cargo registry downloads and git checkouts", [
      join(HOME, ".cargo", "registry", "cache"),
      join(HOME, ".cargo", "registry", "src"),
      join(HOME, ".cargo", "git", "checkouts"),
    ]),
    commandCache(
      {
        id: "go-build",
        description: "Go build cache",
        paths: [join(library, "Caches", "go-build")],
      },
      ["go", "clean", "-cache"],
    ),
    commandCache(
      {
        id: "go-modules",
        description: "Go module cache",
        note: "Offline builds fail until Go downloads the modules again.",
        paths: [join(HOME, "go", "pkg", "mod")],
      },
      ["go", "clean", "-modcache"],
    ),
    directoryCache("gradle", "Gradle caches", [join(HOME, ".gradle", "caches")]),
    directoryCache("maven", "Maven local repository", [join(HOME, ".m2", "repository")]),
    directoryCache("xcode-derived-data", "Xcode DerivedData", [join(xcode, "DerivedData")]),
    directoryCache(
      "xcode-device-support",
      "Xcode device support files",
      [join(xcode, "iOS DeviceSupport"), join(xcode, "watchOS DeviceSupport")],
      "Xcode copies them again from the device on the next connection. This is slow.",
    ),
    directoryCache("simulator-caches", "iOS Simulator caches", [
      join(library, "Developer", "CoreSimulator", "Caches"),
    ]),
    directoryCache(
      "trash",
      "Items in the Trash",
      [join(HOME, ".Trash")],
      "DATA LOSS: the user cannot get the items back. Ask the user first.",
    ),
    ...podmanCaches(),
  ];
}

/** Gives true when the path is a direct subdirectory of one of the cache roots. */
export function isCacheDirectory(path: string): boolean {
  const target = resolve(path);

  return CACHE_ROOTS.includes(dirname(target));
}

function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/**
 * Gives the subdirectories of the cache roots. It does not give the directories that a tool cache
 * in `caches` contains, because the tool cache cleans them.
 */
export async function cacheDirectories(caches: ToolCache[]): Promise<string[]> {
  const owned = caches.flatMap((cache) => cache.paths);
  const listings = await Promise.all(
    CACHE_ROOTS.map(async (root) => {
      const entries = await readdir(root, { withFileTypes: true }).catch(() => []);

      return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name));
    }),
  );

  return listings.flat().filter((dir) => !owned.some((path) => overlaps(path, dir)));
}
