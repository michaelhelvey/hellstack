# alpha

Alpha is the shared integration environment. CI deploys each merge to `main`. Other people use it,
so a run writes only data that it tags as test data.

## Deploy

- CI deploys each merge to `main` with the `deploy-alpha` workflow. To deploy a branch, run
  `gh workflow run deploy-alpha --ref <branch>`, then `gh run watch`. Ask the user first. This
  changes a shared environment.
- Roll back: `gh workflow run deploy-alpha --ref <last-good-sha>`.
- Deployed version: `curl -s https://notes.alpha.example.com/api/version | jq -r .commit`. Compare
  it with the commit the user asks about, for example with
  `git merge-base --is-ancestor <commit> <deployed-sha>`.

## Access

- Network: connect to the company VPN. Without it, DNS for `notes.alpha.example.com` fails.
- Cloud: `aws sso login --profile notes-alpha`. All later commands use `AWS_PROFILE=notes-alpha`.
- Site: log in as the test user `verify-bot@example.com`. Get its password with
  `aws secretsmanager get-secret-value --secret-id notes/alpha/verify-bot --query SecretString`.
  `control-notes login --env alpha` does the login and saves the browser state to
  `$TMPDIR/verify-notes/alpha-auth.json`.
- Database: Postgres, read-only role `notes_ro`. Run `control-notes db --env alpha`. It reads the
  password from `notes/alpha/db-ro` and opens `psql`.

## Doctor

- Run `control-notes doctor --env alpha`. It checks the VPN path, the AWS session, the login of the
  test user, the database connection, and prints the deployed commit.

## Driving differences

- Set `--env alpha` on each helper. It sets `BASE_URL` and loads the saved browser state.
- Prefix each title that a run creates with `[verify $RUN_ID]`.
- Search results include notes from other users of alpha. Assert that a result is present, not that
  the list has an exact length.

## Mutation policy

- `tagged`. Create, change, and delete only notes whose title starts with `[verify $RUN_ID]`.

## Observability

- Logs: `aws logs tail /notes/alpha/api --since 15m --profile notes-alpha`.
- Errors: the `notes` project in the error tracker, environment `alpha`.

## Gotchas

- The `deploy-alpha` workflow returns before the new tasks are healthy. Wait until `/api/version`
  shows the new commit.
- The test user session expires after 1 hour. If a drive gets a login page, run
  `control-notes login --env alpha` again and doctor again.
