# @hellstack/amp

Publishes hellstack to Amp orbs and Puck. Amp loads the personal skills and plugins repositories
everywhere you use Amp, so this package writes to those repositories, not to `~/.config/amp`.

| What                     | Where in Amp                      | Source                                                                     |
| ------------------------ | --------------------------------- | -------------------------------------------------------------------------- |
| pstack, patched for Amp  | personal skills (`user-skills`)   | `ampPatches` in [`@hellstack/pstack`](../pstack/README.md#amp)             |
| personal skills for orbs | personal skills (`user-skills`)   | `personalSkillPatches` in `src/skills.ts`                                  |
| the chinchilla modes     | personal plugins (`user-plugins`) | `plugin/hellstack/`, with the chinchilla style of `@hellstack/claude-code` |
| orb secrets              | personal secrets                  | `secretSpecs` in `src/secrets.ts`                                          |
| Puck instructions        | Settings → Puck (by hand)         | `puck.md`                                                                  |

## Publish

```sh
bun run amp:publish --dry-run   # show the changes only
bun run amp:publish             # commit, then ask before each push
```

The command keeps checkouts in `~/.cache/hellstack/amp/`. It changes only the files that it wrote
before (`.hellstack-managed.json`), so skills that Amp adds to the repositories stay. A push
publishes the change. New threads load it.

## The chinchilla modes

The plugin adds `chinchilla-low`, `chinchilla-medium`, `chinchilla-high`, and `chinchilla-ultra`.
Each mode is the built-in mode with the chinchilla voice and the pstack routing rule added to its
prompt. Put them on your dial in **Settings → Mode Dial → Build Dial**.

Tune Modes does not change a plugin mode, so each mode pins its main agent, Oracle, and subagent
models in `chinchillaModes` in `plugin/hellstack/index.ts`. When you change a pin in Tune Modes,
change it there too. Each pinned model must be in the model mapping of a provider connection
(`amp config model-providers list --workspace --json`), or Amp serves it with Amp credits.

## Secrets

```sh
bun run amp:secrets         # show which secrets Amp has
bun run amp:secrets --set   # copy the values from this shell to your Amp secrets
```

`--set` reads each value from the local environment variables in `secretSpecs`. A value that is not
in this shell stays as it is in Amp. Orbs that are running get new values after
`amp orb restart-processes`.

## Puck

Plugins do not load in Puck, and Amp has no command for Puck's custom instructions. Copy `puck.md`
into **Settings → Puck → Custom instructions** by hand.
