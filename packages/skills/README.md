# @hellstack/skills

The single source of truth for my agent skills. Claude Code, opencode, and pi use these skills.

Each skill is a directory in `skills/` with a `SKILL.md` file:

```
skills/
  <skill-name>/
    SKILL.md
    references/   # optional
    scripts/      # optional
```

## Add a manual skill

Make a new directory in `skills/`. The skills.sh commands do not change manual skills.

Write skill scripts in TypeScript for `bun`. `bun run check` type-checks them. Put their tests in
`tests/`, not in the skill directory, because the skill directory is copied to each harness.

A synced skill has no `node_modules`. A script that needs packages at run time must install them
itself (see `skills/tldraw/scripts/lib/deps.ts`). Add the same packages as `devDependencies` of this
package for type checking.

## Add a skill from skills.sh

Run these commands from the repository root:

```sh
bunx skills add <source> --list              # show the skills in a source
bun run skills:add <source> <skill...>       # install skills into skills/
bun run skills:update [skill...]             # update all or some skills.sh skills
bun run skills:remove <skill...>             # remove skills.sh skills
```

For example: `bun run skills:add herdrdev/herdr herdr`.

`skills-lock.json` records the source of each skills.sh skill. Commit it with the skill files.

Do not run `bunx skills add` or `bunx skills update` directly. They write to other directories.
