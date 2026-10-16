# @hellstack/amp

Publishes hellstack to Amp. Amp loads your personal skills and plugins repositories in every thread
and orb, so this package writes to those repositories.

| What            | Where in Amp                      | Source                                                                             |
| --------------- | --------------------------------- | ---------------------------------------------------------------------------------- |
| The skills      | personal skills (`user-skills`)   | [`@hellstack/skills`](../skills/README.md), except `localSkills` in `src/build.ts` |
| The plugin      | personal plugins (`user-plugins`) | `plugin/hellstack/` and [`@hellstack/prompts`](../prompts/README.md)               |
| The orb secrets | personal secrets                  | `secretSpecs` in `src/secrets.ts`                                                  |

## Publish

```sh
bun run amp:publish --dry-run   # show the changes only
bun run amp:publish             # commit, then ask before each push
```

The command keeps checkouts in `~/.cache/hellstack/amp/`. It changes only the files that it wrote
before (`.hellstack-managed.json`), so skills that Amp adds to the repositories stay. New threads
get the change.

## The plugin

The plugin adds the instructions, the chinchilla voice, pstack, and the Amp notes for pstack
(`plugin/hellstack/pstack-amp.md`) to the first prompt of each thread, in every mode. Later prompts
get a short reminder. Plugins cannot change the system prompt of a built-in mode, so the text goes
in a hidden message.

`pstack-amp.md` also has the pstack models sheet. It maps each pstack role to a built-in mode or to
the oracle, so the models are the ones that you set in Tune Modes. A test fails when a skill names a
role that the sheet does not have.

Plugins do not load in Puck. Paste [`chinchilla.md`](../prompts/chinchilla.md) into **Settings →
Puck → Custom instructions**.

## Secrets

```sh
bun run amp:secrets         # show which secrets Amp has
bun run amp:secrets --set   # copy the values from this shell to your Amp secrets
```

`--set` reads each value from the local environment variables in `secretSpecs`. A value that is not
in this shell stays as it is in Amp. Orbs that are running get new values after
`amp orb restart-processes`.
