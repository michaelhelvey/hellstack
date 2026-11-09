# prod

Prod is the environment that users use. A run never writes to it.

## Deploy

- An agent never deploys prod. A release manager promotes a release with the `deploy-prod` workflow.
- Deployed version: `curl -s https://notes.example.com/api/version | jq -r .commit`.

## Access

- Site: the read-only test user `verify-readonly@example.com`. Password in
  `notes/prod/verify-readonly`. Run `control-notes login --env prod`.
- Database: no access for agents.

## Doctor

- Run `control-notes doctor --env prod`. It checks the login and prints the deployed commit.

## Driving differences

- Only read-only journeys. The feature files say which ones.

## Mutation policy

- `read-only`.

## Observability

- Errors: the `notes` project in the error tracker, environment `production`.

## Gotchas

- The read-only test user has no notes of its own. Search journeys use the shared demo notes.
