# @hellstack/skills

All my agent skills. This package is a pi package, so pi loads the skills from here.

Each skill is a directory in `skills/` with a `SKILL.md` file:

```
skills/
  <skill-name>/
    SKILL.md
    references/   # optional
    scripts/      # optional
```

The package manifest does not load `skills/herdr` and `skills/rex`. The `multiplexer` extension of
[`@hellstack/pi`](../pi/README.md) loads one of them only in a herdr-core terminal or a Rex
terminal. Other code gets the folder of a skill with `skillDir(name)` from `@hellstack/skills`.

`skills/herdr` is a local skill. It points at `hc --skill` and `herdr-app --skill`, so its commands
match the installed Herdr version. It is not in `skills-lock.json`.

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
in the skill directory.

Add the packages that a script needs to `dependencies` of this package, and import them as usual.
`bun install` at the repository root installs them.

## Add a private skill

For a skill that must not be in this repository, put it in `~/.pi/agent/skills/<skill-name>/`. Pi
loads it on that machine only.

## Add a skill from skills.sh

Run these commands from the repository root:

```sh
bunx skills add <source> --list              # show the skills in a source
bun run skills:add <source> <skill...>       # install skills into skills/
bun run skills:update [skill...]             # update all or some skills.sh skills
bun run skills:remove <skill...>             # remove skills.sh skills
```

For example: `bun run skills:add modem-dev/hunk hunk-review`.

`skills-lock.json` records the source of each skills.sh skill. Commit it with the skill files.

The lint and format commands do not change skills.sh skills, so that updates apply cleanly.
`rstack.config.ts` reads the list from `skills-lock.json`.

Do not run `bunx skills add` or `bunx skills update` directly. They write to other directories.
