# local

The local environment is a disposable Notes instance that this run starts and owns.

## Deploy

- Run `control-notes launch --data-dir /tmp/notes-verify-$RUN_ID`. It installs dependencies, runs
  migrations, seeds `Quarterly plan` and `Grocery list`, and starts the server on a free port.
- Ready when the log line `notes: listening` appears and `GET /api/notes` returns the two seeded
  notes.
- Run `control-notes stop --run $RUN_ID` to stop only the processes this run started.

## Access

- Site: no login. The dev server uses the fixed user `dev@example.com`.
- Database: SQLite file at `$NOTES_DATA_DIR/notes.db`. Run `sqlite3 $NOTES_DATA_DIR/notes.db`.

## Doctor

- Run `control-notes doctor --env local`. It checks that this run owns the port, that the build
  revision equals `git rev-parse HEAD`, and that the data directory is the disposable one.

## Driving differences

- None. The feature recipes use local as the reference.

## Mutation policy

- `free`. The data directory is disposable.

## Observability

- Server log: `$NOTES_DATA_DIR/server.log`.

## Gotchas

- A second launch with the same `RUN_ID` reuses the data directory. Use a new `RUN_ID` per run.
