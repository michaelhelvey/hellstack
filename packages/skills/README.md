# @hellstack/skills

All my agent skills, pstack included. This package is a pi package, so pi loads the skills from
here. `bun run amp:publish` copies them to Amp.

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

## Turn off a group of skills

Turn off a group of skills in pi without removing it:

```sh
bun run skills:groups                  # show the groups and which are off
bun run skills:disable pstack          # turn off all the pstack skills
bun run skills:enable pstack           # turn them on again
```

All the skills of `upstream.json` (pstack, thermos, and cursor-team-kit) are in the `pstack` group.
The skills.sh skills are in groups by source (for example `herdrdev/herdr`). Manual skills are not
in a group. The commands write `-skills/<name>` filters to `~/.pi/agent/settings.json`, so the
change stays after a restart and after `bun run sync`. Run `/reload` in pi to apply it. When
`poteto-mode` is off, the pstack section is not in the system prompt. Amp is not changed.

## Add a manual skill

Make a new directory in `skills/`. The skills.sh commands do not change manual skills.

Write skill scripts in TypeScript for `bun`. Add the skill directory to `include` in
`tsconfig.json`, so that `bun run check` type-checks the scripts. Put their tests in `tests/`, not
in the skill directory, because the skill directory is copied to Amp.

A skill in Amp has no `node_modules`. A script that needs packages at run time must install them
itself (see `skills/tldraw/scripts/lib/deps.ts`). Add the same packages as `devDependencies` of this
package for type checking.

## Add a private skill

For a skill that must not be in this repository, put it in `~/.pi/agent/skills/<skill-name>/`. Pi
loads it on that machine only.

## pstack

The pstack skills, and some skills of cursor-team-kit and thermos, come from
[cursor/plugins](https://github.com/cursor/plugins). They are rewritten so that they work in pi and
Amp. `upstream.json` lists them and the upstream commit. To update them, tell an agent "update
pstack". The `update-pstack` project skill (`.agents/skills/update-pstack`) uses these commands:

```sh
bun run pstack diff                    # the upstream changes since the commit in upstream.json
bun run pstack add <skill> <path...>   # copy a new upstream skill
bun run pstack bump                    # set upstream.json to the upstream HEAD
```

`tests/house-style.test.ts` fails on Cursor and Claude Code words in these skills.

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

The lint and format commands do not change skills.sh and pstack skills, so that updates apply
cleanly. `rstack.config.ts` reads the list from `skills-lock.json` and `upstream.json`.

Do not run `bunx skills add` or `bunx skills update` directly. They write to other directories.
