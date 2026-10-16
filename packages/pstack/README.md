# @hellstack/pstack

Installs [pstack](https://github.com/michael-denyer/pstack-claude) in pi, with the changes of
hellstack. `vendor/pstack-claude` is a git submodule. `bun run sync` patches a copy of it and writes
the copy to `~/.pi/agent/vendor/pstack`. The sync of `@hellstack/pi` adds that directory to
`packages` in `settings.json`. The sync also copies the pstack verification skills (`claudeSkills`
in `hellstack.sync.ts`) to `~/.claude/skills`.

## Changes

`src/patches.ts` has all the changes:

- The package does not have the pstack agent runner. The `herdr-agents` extension of `@hellstack/pi`
  supplies the subagents, and `pi-tools.md` tells the model how to use them for pstack.
- The comment rule of hellstack replaces the `no-comments` skill and the Comments section of
  poteto-mode.

| Field       | What it does                                                                             |
| ----------- | ---------------------------------------------------------------------------------------- |
| `include`   | The upstream files and directories to copy, relative to `plugins/pstack`.                |
| `drop`      | The files and directories in `include` to leave out.                                     |
| `overrides` | Files in `overrides/` that replace upstream files, with the hash of the upstream file.   |
| `edits`     | Text changes: `replaceOnce`, `removeLine`, and `replaceSection`. Each must match 1 time. |
| `forbidden` | Text that no file in the copy can contain, for example `no-comments`.                    |
| `dropLines` | Lines to remove from every Markdown file, for example the pointers to other runtimes.    |

Use an edit for a small change. Use an override only when you replace most of a file.

## Amp

`src/amp-patches.ts` has a second patch set, `ampPatches`, for Amp orbs and Puck. `buildAmpPstack`
applies it, with the overrides in `amp-overrides/`, and gives the skills as top-level directories.
[`@hellstack/amp`](../amp/README.md) publishes them to the Amp personal skills repository.

- `references/amp-tools.md` maps the Claude Code tools to the Amp tools.
- Amp threads replace the local transcripts (`recall`, `reflect`, Session pickup).
- Amp's GitHub subscriptions replace the PR polling loops (`babysit`, the Babysit playbook).
- The skills and files for local machines and for other runtimes are not in the tree, for example
  `setup-pstack` and the worktree cleanup.

## Update pstack

```sh
git -C packages/pstack/vendor/pstack-claude pull origin main
bun run sync --dry-run
```

When the sync cannot apply a patch, it stops and tells you which patch and why:

- An edit does not match: find the new upstream text, and change the edit.
- An upstream file of an override changed: compare the override with the new upstream file, change
  the override, then set `upstream` to the hash in the error.
- Forbidden text: upstream added a new reference. Add an edit or a drop for it.

`bun test packages/pstack/tests packages/amp/tests` also applies both patch sets to the submodule,
and checks that the patches do not break the extension imports or the Markdown links. The
`update-pstack` project skill (`.agents/skills/update-pstack`) does all of this for an agent.
