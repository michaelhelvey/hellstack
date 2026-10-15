import { basename, dirname, join, resolve, sep } from "node:path";

import { exists, mtime, run } from "./fs.ts";

/** A type of build artifact directory that a tool can make again from the source code. */
export interface ArtifactRule {
  /** The name of the directory. */
  name: string;
  /** The tool that makes the directory. */
  kind: string;
  /**
   * The files that tell that the directory is an artifact. One of them must be in the parent
   * directory. An empty list means that the name is sufficient.
   */
  markers: string[];
}

/** The artifact directories that the scan finds in the source code roots. */
export const ARTIFACT_RULES: readonly ArtifactRule[] = [
  { name: "node_modules", kind: "node", markers: ["package.json"] },
  { name: ".next", kind: "next", markers: ["package.json"] },
  { name: ".nuxt", kind: "nuxt", markers: ["package.json"] },
  { name: ".svelte-kit", kind: "svelte", markers: ["package.json"] },
  { name: ".turbo", kind: "turbo", markers: ["package.json"] },
  { name: ".parcel-cache", kind: "parcel", markers: ["package.json"] },
  { name: "target", kind: "rust", markers: ["Cargo.toml"] },
  {
    name: ".venv",
    kind: "python",
    markers: ["pyproject.toml", "requirements.txt", "uv.lock", "setup.py"],
  },
  { name: "__pycache__", kind: "python", markers: [] },
  { name: ".pytest_cache", kind: "python", markers: [] },
  { name: ".mypy_cache", kind: "python", markers: [] },
  { name: ".ruff_cache", kind: "python", markers: [] },
  { name: ".zig-cache", kind: "zig", markers: ["build.zig"] },
  { name: "zig-cache", kind: "zig", markers: ["build.zig"] },
  { name: ".build", kind: "swift", markers: ["Package.swift"] },
  {
    name: ".gradle",
    kind: "gradle",
    markers: ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"],
  },
];

/** An artifact directory that the scan found. */
export interface Artifact {
  path: string;
  kind: string;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ruleFor(name: string): ArtifactRule | undefined {
  return ARTIFACT_RULES.find((rule) => rule.name === name);
}

async function hasMarker(path: string, rule: ArtifactRule): Promise<boolean> {
  if (rule.markers.length === 0) return true;

  const found = await Promise.all(
    rule.markers.map((marker) => exists(join(dirname(path), marker))),
  );

  return found.includes(true);
}

/** Gives the artifact for the path, or undefined when the path is not an artifact directory. */
export async function classify(path: string): Promise<Artifact | undefined> {
  const rule = ruleFor(basename(path));

  if (!rule || !(await hasMarker(path, rule))) return undefined;

  return { path, kind: rule.kind };
}

/**
 * Finds the artifact directories in the roots with `fd`. The search does not go into an artifact
 * directory or into `.git`, so it gives only the top artifact of a tree.
 */
export async function findArtifacts(roots: string[]): Promise<Artifact[]> {
  const pattern = `^(${ARTIFACT_RULES.map((rule) => escapeRegex(rule.name)).join("|")})$`;
  const args = ["fd", "--hidden", "--no-ignore", "--type", "d", "--prune", "--exclude", ".git"];
  const { code, stdout } = await run([...args, "--absolute-path", pattern, ...roots]);

  if (code !== 0) throw new Error(`fd failed with exit code ${code}. Is fd on PATH?`);

  const paths = stdout
    .split("\n")
    .filter(Boolean)
    .map((path) => path.replace(/\/$/, ""));
  const artifacts = await Promise.all(paths.map(classify));

  return artifacts.filter((artifact) => artifact !== undefined);
}

/** Gives true when the path is in one of the roots, and is not a root. */
export function isInside(path: string, roots: string[]): boolean {
  const target = resolve(path);

  return roots.some((root) => target.startsWith(resolve(root) + sep));
}

async function gitActivity(dir: string, root: string): Promise<number | undefined> {
  const time = await mtime(join(dir, ".git", "logs", "HEAD"));
  const parent = dirname(dir);

  if (time !== undefined || dir === root || parent === dir) return time;

  return gitActivity(parent, root);
}

/**
 * Gives the time of the last activity in the project of the artifact, in milliseconds. This is the
 * time of the last git commit or checkout. When the project has no git log, it is the modification
 * time of the project directory.
 */
export async function lastActivity(artifact: Artifact, roots: string[]): Promise<number> {
  const project = dirname(artifact.path);
  const root = roots.find((candidate) => isInside(artifact.path, [candidate])) ?? project;

  return (await gitActivity(project, resolve(root))) ?? (await mtime(project)) ?? Date.now();
}
