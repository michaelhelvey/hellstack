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

## My Philosophy of Skills

In my opinion, skills have two possible uses:

1. A "token cache" to store research that you don't want to the agent to have to learn how to do
   again. For example, I have a skill for jira tasks so that the agent doesn't have to re-learn how
   my particular company's jira boards work every time I ask it to do something. It doesn't _need_
   the skill, but it saves some turns.
2. A pre-defined prompt library. There are certain prompts that I run over and over again (e.g.
   architect), and so I find them useful to just save.

There's a reason why I have `disable-model-invocation: true` on almost every skill. I want to invoke
it explicitly to make the model do something, I don't really have any interest in trying to
implicitly skew model behavior. The models are too smart and changing too fast for this to be
useful.

## Add a manual skill

Make a new directory in `skills/`. The skills.sh commands do not change manual skills.

Write skill scripts in TypeScript for `bun`. Add the skill directory to `include` in
`tsconfig.json`, so that `bun run check` type-checks the scripts. Put their tests in `tests/`, not
in the skill directory, because the skill directory is copied to each harness.

A synced skill has no `node_modules`. A script that needs packages at run time must install them
itself (see `skills/tldraw/scripts/lib/deps.ts`). Add the same packages as `devDependencies` of this
package for type checking.

## Add a private layer skill

For a skill that must not be in this repository, put it in
`~/.config/hellstack/layers/<layer>/skills/<skill-name>/`. The sync copies it only when the layer is
on. A layer skill cannot have the same name as a skill in `skills/`.

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

The lint, format, and test commands do not examine skills.sh skills, because they are third-party
code. `rstack.config.ts` reads the list of these skills from `skills-lock.json`.

Do not run `bunx skills add` or `bunx skills update` directly. They write to other directories.
