import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { z } from "zod";

const upstreamSchema = z.object({
  repo: z.string(),
  commit: z.string(),
  watch: z.array(z.string()),
  skipped: z.array(z.string()),
  skills: z.record(z.string(), z.array(z.string())),
});

/** The data in `upstream.json`: the skills that come from one upstream repository. */
export type Upstream = z.infer<typeof upstreamSchema>;

/** The package directory. */
export const packageDir = join(import.meta.dir, "..");

/** The path of `upstream.json`. */
export const upstreamPath = join(packageDir, "upstream.json");

const cacheDir = join(
  process.env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache"),
  "hellstack",
  "upstream",
);

/** Reads `upstream.json`. */
export async function readUpstream(path = upstreamPath): Promise<Upstream> {
  return upstreamSchema.parse(JSON.parse(await Bun.file(path).text()));
}

async function writeUpstream(upstream: Upstream): Promise<void> {
  await writeFile(upstreamPath, `${JSON.stringify(upstream, null, 2)}\n`);
}

function gitBytes(args: string[]): Uint8Array {
  const result = Bun.spawnSync(["git", ...args], { cwd: cacheDir, stderr: "pipe" });
  if (!result.success)
    throw new Error(`git ${args.join(" ")} failed:\n${result.stderr.toString()}`);
  return result.stdout;
}

function git(args: string[]): string {
  return new TextDecoder().decode(gitBytes(args));
}

async function fetchUpstream(repo: string): Promise<string> {
  if (!(await Bun.file(join(cacheDir, ".git", "HEAD")).exists())) {
    await mkdir(cacheDir, { recursive: true });
    git(["clone", "--quiet", "--filter=blob:none", "--no-checkout", repo, "."]);
  }
  git(["fetch", "--quiet", "origin"]);
  return git(["rev-parse", "origin/HEAD"]).trim();
}

/**
 * Returns the paths in the watched directories at `commit` that no skill tracks and that are not
 * skipped. These are new upstream skills or agents.
 */
export function untracked(upstream: Upstream, listed: string[]): string[] {
  const known = [...Object.values(upstream.skills).flat(), ...upstream.skipped];
  return listed.filter(
    (path) => !known.some((done) => path === done || path.startsWith(`${done}/`)),
  );
}

function listWatched(upstream: Upstream, commit: string): string[] {
  const roots = upstream.watch.map((root) => `${root}/`);
  return git(["ls-tree", "--name-only", commit, ...roots])
    .split("\n")
    .filter(Boolean);
}

async function diff(): Promise<void> {
  const upstream = await readUpstream();
  const head = await fetchUpstream(upstream.repo);
  const paths = Object.values(upstream.skills).flat();
  console.log(`# ${upstream.repo} ${upstream.commit.slice(0, 12)}..${head.slice(0, 12)}\n`);
  console.log(git(["diff", `${upstream.commit}..${head}`, "--", ...paths]) || "No changes.");
  const fresh = untracked(upstream, listWatched(upstream, head));
  if (fresh.length > 0) console.log(`\n# New upstream paths\n\n${fresh.join("\n")}`);
}

/** A path named like the skill gives its contents. Any other path keeps its name. */
function extract(commit: string, path: string, skill: string): void {
  const archive = gitBytes(["archive", "--format=tar", commit, path]);
  const strip = path.split("/").length - (basename(path) === skill ? 0 : 1);
  const tar = ["tar", "-x", `--strip-components=${strip}`, "-C", join(packageDir, "skills", skill)];
  if (!Bun.spawnSync(tar, { stdin: archive }).success) throw new Error(`cannot extract ${path}`);
}

/** Returns `upstream` with `paths` added to the tracked paths of `skill`. */
export function track(upstream: Upstream, skill: string, paths: string[]): Upstream {
  const tracked = new Set([...(upstream.skills[skill] ?? []), ...paths]);
  return { ...upstream, skills: { ...upstream.skills, [skill]: [...tracked] } };
}

async function add([skill, ...paths]: string[]): Promise<void> {
  if (skill === undefined || paths.length === 0) throw new Error(usage);
  const upstream = await readUpstream();
  const head = await fetchUpstream(upstream.repo);
  await mkdir(join(packageDir, "skills", skill), { recursive: true });
  for (const path of paths) extract(head, path, skill);
  await writeUpstream(track(upstream, skill, paths));
}

async function bump(): Promise<void> {
  const upstream = await readUpstream();
  const head = await fetchUpstream(upstream.repo);
  await writeUpstream({ ...upstream, commit: head });
  console.log(`upstream.json is at ${head}`);
}

const usage = `Usage:
  bun run pstack diff                  Show the upstream changes since the commit in upstream.json
  bun run pstack add <skill> <path...> Copy upstream paths at the upstream HEAD into skills/<skill>.
                                       A path named <skill> gives its contents, any other path
                                       keeps its name (for example agents/).
  bun run pstack bump                  Set the commit in upstream.json to the upstream HEAD`;

const commands: Record<string, (args: string[]) => Promise<void>> = { diff, add, bump };

if (import.meta.main) {
  const [name = "", ...args] = process.argv.slice(2);
  const command = commands[name];
  if (command === undefined) {
    console.error(usage);
    process.exit(1);
  }
  await command(args);
}
