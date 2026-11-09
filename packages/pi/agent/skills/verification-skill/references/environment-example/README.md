# Notes environments

This directory tells an agent how to deploy, get access to, and verify Notes in each environment.
Read the row for the environment, then read its file before you drive it.

| Environment | Purpose             | Entry point                       | How code gets there           | Mutation policy | File                   |
| ----------- | ------------------- | --------------------------------- | ----------------------------- | --------------- | ---------------------- |
| local       | Development         | `http://127.0.0.1:4173`           | `control-notes launch`        | `free`          | [local.md](./local.md) |
| alpha       | Integration testing | `https://notes.alpha.example.com` | CI deploys each merge to main | `tagged`        | [alpha.md](./alpha.md) |
| prod        | Users               | `https://notes.example.com`       | Manual promotion of a release | `read-only`     | [prod.md](./prod.md)   |

## Shared rules

- Run `control-notes doctor --env <env>` before the first drive and after any surprise.
- Every helper takes `--env <env>`. The default is `local`.
- Read the deployed version before you report a result. A pass for code that is not deployed is not
  a pass.
- Put evidence in `$TMPDIR/verify-notes/<run-id>/<env>/`. Cleanup never removes it.
- Never write a secret value into this skill. Name where the secret comes from.
