---
name: update-pstack
description:
  Updates the pstack submodule of hellstack to the latest upstream version, and repairs the pi and
  Amp patch sets until they apply. Use when the user asks to update, sync, or pull pstack, or when a
  scheduled run asks for it.
---

# Update pstack

hellstack vendors pstack as a git submodule at `packages/pstack/vendor/pstack-claude`. Two patch
sets change it:

- `pstackPatches` in `packages/pstack/src/patches.ts`, for pi, with the overrides in
  `packages/pstack/overrides/`.
- `ampPatches` in `packages/pstack/src/amp-patches.ts`, for Amp orbs and Puck, with the overrides in
  `packages/pstack/amp-overrides/`. `amp-overrides/skills/poteto-mode/references/amp-tools.md` maps
  the Claude Code tools to the Amp tools.

Read `packages/pstack/README.md` before you start.

## Steps

1. Record the current submodule commit:
   `git -C packages/pstack/vendor/pstack-claude rev-parse --short HEAD`.
2. Update the submodule:
   `git -C packages/pstack/vendor/pstack-claude fetch origin && git -C packages/pstack/vendor/pstack-claude checkout origin/main`.
   If the commit did not change, stop and tell the user that pstack is current.
3. Read what changed upstream: the new entries in `CHANGES.md` of the submodule, and
   `git -C packages/pstack/vendor/pstack-claude diff --stat <old>..HEAD -- plugins/pstack`.
4. Apply both patch sets: `timeout 120 bun test packages/pstack/tests packages/amp/tests`. Do not
   run `bun test packages/pstack`, because that also runs the upstream tests in the submodule.
5. Repair each failure. The error names the file and the patch:
   - An edit does not match. Find the new upstream text and change the edit. Keep the intent of the
     edit.
   - The upstream file of an override changed. Compare the override with the new upstream file, move
     the upstream changes into the override, then set `upstream` to the hash in the error.
   - Forbidden text. Upstream added a new reference to a thing that the tree does not have. Add an
     edit or a drop for it.
   - A broken Markdown link. A patch dropped a file that a new upstream file links to. Drop the new
     file too, or remove the link with an edit.
6. Read the upstream changes again for the Amp tree. Look for new features that need a local machine
   (local transcripts, worktrees, desktop apps, hooks, `~/.claude` paths) and for new Claude Code
   tool names. Map a new tool in `amp-tools.md`. Drop a skill or a file that cannot work in an orb,
   and give the reason in the commit message.
7. Run `bun run validate`. It must pass.
8. Run `bun run amp:publish --dry-run` and read the list of changed skill files.
9. Report the old and new submodule commits, each patch that you changed and why, and the dry-run
   list. Commit on a new branch and open a pull request only when the user asked for it, or when a
   scheduled run asked for it. Do not publish to Amp. The user runs `bun run amp:publish`.
