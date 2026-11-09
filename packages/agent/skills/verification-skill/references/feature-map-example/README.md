# Notes verification map

This directory is the maintained source for verifying the user-facing behavior of Notes. Read the
index before you drive the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Doctor the target environment with `control-notes doctor --env <env>`, and require the expected
  URL and version.
- For local, set `NOTES_DATA_DIR=/tmp/notes-verify-$RUN_ID` so that runs do not share state, and
  seed notes titled `Quarterly plan` and `Grocery list`.
- For a deployed environment, read its file in `environments/` first, and obey its mutation policy.
- Never drive a local instance that this run did not start.

## Driving conventions

- Start each recipe from the baseline state unless its preconditions say otherwise.
- Prefer ARIA roles and accessible names to CSS selectors or DOM position.
- Each command is literal. Keep quoted names and flags unchanged.
- Run browser actions through `control-notes browser --env <env>`.
- Run terminal actions through `control-notes cli --env <env> -- <command>`.
- Restore seeded data after a mutation. Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot with the app identity visible.
- CLI proof includes the command, stdout, stderr, and exit code.
- Mutation proof includes a read-only second view of the stored value.
- Record the feature ID, the entry point, the environment, and the deployed version with each
  artifact.
- Report an unreachable path with the command you tried and the precondition that was not met.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph that describes the user-visible
behavior. It then has exactly five H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists each user entry point.
3. `Driving it with <harness>` starts with `Preconditions:` and uses labeled bullets that pair each
   user action with an exact command and an observable result.
4. `Environments` lists each environment, which sub-features it can prove, and how its recipe is
   different.
5. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state,
commands, and observable proof.

## Features

- [Create a note](./create-note.md) covers browser and CLI creation, cancellation, persistence, and
  cleanup.
