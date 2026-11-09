---
name: cleanup-macos
description:
  Frees disk space on macOS. Removes tool caches (Homebrew, npm, pnpm, Bun, uv, Cargo, Go, Xcode),
  Podman images, app caches, and build artifacts (node_modules, Rust target, .venv, and more) in
  ~/dev. Keeps the source code. Use when the user asks to clean up the Mac or to free disk space.
disable-model-invocation: true
---

# Clean up macOS

You are the manager of the cleanup. Two scripts do the work:

- `scripts/scan.ts` finds what the cleanup can remove and gives sizes. It does not change files.
- `scripts/clean.ts` removes the targets that you give it.

You decide which targets to remove. Do not remove files with other commands (`rm`, `find -delete`).
`clean.ts` refuses all the targets when one target is not a known tool cache, a project artifact
next to its marker file (for example, `target` next to `Cargo.toml`), or a cache directory. This
rule keeps the source code safe.

All paths below are relative to the directory of this skill.

## Requirements

`bun` and `fd` on `PATH`. The other tools are optional. The scan does not show the caches of tools
that are not on this Mac.

## Step 1. Scan

```bash
bun scripts/scan.ts
```

The scan takes approximately 30 seconds, because `du` measures each directory. Options:

- `--root DIR`: search a different source code directory for artifacts. Repeat for more directories.
  The default is `~/dev`. Give the same roots to `clean.ts`.
- `--min-size MB`: do not show items smaller than this. The default is 50.

The output has three tab-separated tables:

- **Tool caches**: one `ID` for each cache. Give the ID to `clean.ts`.
- **Project artifacts**: `IDLE` is the number of days since the last git commit or checkout in the
  project. Give the `PATH` to `clean.ts`.
- **Cache directories**: the subdirectories of `~/Library/Caches` and `~/.cache`. Give the `PATH` to
  `clean.ts`.

Sizes come from `du`. Tools such as pnpm use hard links, so the real free space can be less than the
total.

## Step 2. Make a plan

Put each item in one of three groups. Use these rules. If an item is not in the rules, use your
judgment: remove what a tool can download or make again, and keep what the user made or must
configure again.

**Remove.** No risk. The tools download or build the data again.

- Tool caches: `npm`, `bun`, `yarn`, `uv`, `cargo`, `go-build`, `homebrew`, `gradle`, `maven`,
  `xcode-derived-data`, `simulator-caches`, `pnpm` (prune removes only unused packages).
- Project artifacts with `IDLE` of 30 days or more.
- Python and Zig caches (`__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`,
  `.zig-cache`), at all ages.
- Project artifacts in `~/dev/thirdparty` and in git worktree directories, at all ages.
- Cache directories of tools that download again, for example `puppeteer`, `ms-playwright`,
  `node-gyp`, `typescript`, and the caches of skill scripts.

**Ask the user.** Removal has a cost, or it can lose data.

- `podman`: it removes stopped containers. First run `podman ps --all --filter status=exited` and
  show the containers to the user, because a stopped container can hold state.
- `podman-volumes` and `trash`: data loss. Remove them only when the user says yes to each one.
- `go-modules` and `xcode-device-support`: a large download or a slow copy again.
- Project artifacts with `IDLE` from 7 to 29 days.
- Large Rust `target` directories with `IDLE` less than 30 days. Offer `cargo sweep --time 7 <path>`
  on the project directory (the parent of `target`). It removes only old build files, so the next
  build stays fast. `cargo sweep` is a cargo subcommand, not part of `clean.ts`.
- Caches of apps that are not running, for example browsers and Spotify. Check with
  `pgrep -il <app>`.

**Keep.**

- Project artifacts with `IDLE` less than 7 days. The user works on these projects now.
- `node_modules` of the project that you run in now.
- Caches of apps that are running.
- `com.apple.*` cache directories. macOS manages them, and many have permissions that stop removal.

Show the plan to the user as a short table for each group, with the size of each item and the total
of each group. Then wait for the user to approve. If the user already told you to continue without
questions, remove the items in the **Remove** group without approval. Items in the **Ask the user**
group always need a yes from the user.

## Step 3. Clean

Give all the approved targets to one command:

```bash
bun scripts/clean.ts npm bun cargo /Users/me/dev/old-project/node_modules /Users/me/dev/crate/target
```

Use `--dry-run` to see the targets without removing them. The command prints `removed` or `failed`
for each target, then the free space before and after. Exit code 1 means that one or more targets
failed. Tell the user which targets failed and why.

## Step 4. Report

Tell the user the free space before and after, and the items that you kept or that are waiting for
their answer.
