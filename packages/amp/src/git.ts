import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/** Runs a command and returns its standard output. It throws an error when the command fails. */
export async function run(command: string[], cwd = process.cwd()): Promise<string> {
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${command.join(" ")} failed (${code}):\n${stderr}${stdout}`);
  return stdout;
}

/** The kind of an Amp-hosted personal repository. */
export type RepoKind = "skills" | "plugins";

const repositoriesSchema = z.array(
  z.object({ scope: z.string(), exists: z.boolean(), cloneURL: z.string() }),
);

async function userRepository(kind: RepoKind): Promise<{ exists: boolean; cloneURL: string }> {
  const output = await run(["amp", kind, "repositories", "--json"]);
  const user = repositoriesSchema.parse(JSON.parse(output)).find((repo) => repo.scope === "user");
  if (user === undefined) throw new Error(`amp ${kind} repositories has no user repository`);
  return user;
}

async function initEmpty(dir: string, cloneURL: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await run(["git", "init", "--quiet", "--initial-branch", "main"], dir);
  await run(["git", "remote", "add", "origin", cloneURL], dir);
  await run(["amp", "git-setup"]);
}

/**
 * Makes `dir` an up-to-date checkout of the user's Amp-hosted skills or plugins repository. Amp
 * makes the repository at the first push, so before that, the checkout is an empty repository
 * with the remote.
 */
export async function checkout(kind: RepoKind, dir: string): Promise<void> {
  const repo = await userRepository(kind);
  if (!existsSync(join(dir, ".git"))) {
    if (repo.exists) await run(["amp", "clone", `user-${kind}`, dir]);
    else await initEmpty(dir, repo.cloneURL);
  } else if (repo.exists) await run(["git", "pull", "--ff-only", "--quiet"], dir);
}

/** Removes the changes in a checkout that are not committed, also in a repository with no commits. */
export async function discard(dir: string): Promise<void> {
  const head = await run(["git", "rev-parse", "--verify", "--quiet", "HEAD"], dir).catch(() => "");
  if (head === "")
    await run(["git", "rm", "-r", "--cached", "--quiet", "--ignore-unmatch", "."], dir);
  else await run(["git", "reset", "--hard", "--quiet"], dir);
  await run(["git", "clean", "-fdq"], dir);
}

/** Stages all changes in a checkout and returns `git status --short`. */
export async function stageAll(dir: string): Promise<string> {
  await run(["git", "add", "-A"], dir);
  return run(["git", "status", "--short"], dir);
}

/** Commits the staged changes, then pushes them to `main`. */
export async function commitAndPush(dir: string, message: string): Promise<void> {
  await run(["git", "commit", "--quiet", "-m", message], dir);
  await run(["git", "push", "--quiet", "-u", "origin", "HEAD:main"], dir);
}
