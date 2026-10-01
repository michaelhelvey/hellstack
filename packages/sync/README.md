# @hellstack/sync

Copies the config and skills in this repository to Claude Code, opencode, and pi. Run it from the
repository root:

```sh
bun run sync               # copy everything, then run the integrations
bun run sync --dry-run     # show the changes only
bun run sync --layers t4   # use these layers, not the layers file
```

## Layers

A layer is a name, for example `t4`. The sync reads the layers of this machine from
`~/.config/hellstack/layers.json`:

```json
{ "layers": ["t4"] }
```

The file is not in the repository. When it does not exist, the sync stops. Write `{ "layers": [] }`
to it for a machine with no layers. When you remove a layer, the next sync removes the files that
only that layer added.

## Manifests

The sync loads `hellstack.sync.ts` from the root of each package in `packages/`, in name order. The
default export makes the files and integrations of the package for the layers:

```ts
import { join } from "node:path";

import { configEntries, defineSync, setJsonValue } from "@hellstack/sync";

export default defineSync(async ({ packageDir, roots, layers }) => ({
  entries: await configEntries(join(packageDir, "config"), roots.claude, {
    "settings.json": (text) => (layers.has("t4") ? setJsonValue(text, ["model"], "x") : text),
  }),
  integrations: [
    { name: "herdr (Claude Code)", command: ["herdr", "integration", "install", "claude"] },
  ],
}));
```

| Export             | What it does                                                                |
| ------------------ | --------------------------------------------------------------------------- |
| `defineSync`       | Makes the manifest. The function gets `packageDir`, `roots`, and `layers`.  |
| `fileEntry`        | Copies one file. A transform can change its text.                           |
| `configEntries`    | Copies each file in a directory. A transform can change a file at its path. |
| `skillEntries`     | Copies each skill directory to each skill target.                           |
| `setJsonValue`     | Sets a value in JSON or JSONC text. It keeps the comments.                  |
| `appendJsonValues` | Adds values to an array in JSON or JSONC text. It keeps the comments.       |

Keep the base files in the repository free of layer data. Layers add or replace values. The sync
stops when two entries write to the same target.

The sync runs the integrations after it writes the files. It skips an integration when its command
is not on the `PATH`.

## Owned files

The sync changes only the files that it owns. Other files in the harness directories stay.

- It records each target in `~/.local/state/hellstack/manifest.json`. When you remove a file or a
  skill from this repository, the next sync removes it from the harness directories.
- When a target has changes that the last sync did not write (for example, a setting that you
  changed in a harness), the sync copies it to `~/.local/state/hellstack/backups/<time>/` before it
  overwrites it. Copy the change into this repository to keep it.

`CLAUDE_CONFIG_DIR`, `XDG_CONFIG_HOME`, `PI_CODING_AGENT_DIR`, and `XDG_STATE_HOME` change the
target directories.
