# @hellstack/herdr

Personal layouts, mods, keys, and themes for the [Herdr](https://herdr.dev/download/) desktop app.

`bun run sync` in the repository root links each file in [`config`](./config) into
`~/.config/herdr-app`. Set `HERDR_APP_DIR` to use a different folder. Herdr writes its own files in
that folder, so the script makes real folders and links only the files. A mod folder is linked as
one unit. When Herdr writes a real file over a link, the next sync moves that file to `<name>.bak`.

## Layouts

Select the personal layout with `herdr-app do layout.switch --name michaelhelvey`. It has the space
picker and tabs across the top. The sidebar starts hidden; Ctrl+F then B shows the spaces and
agents. The file and change icons open the standard Herdr panels.

The native macOS window buttons are outside the visible window (`traffic_lights: [-100, 16]`). Use
the macOS menus or keyboard shortcuts for window controls.

## Factory

`herdr-app do layout.switch --name factory` shows the shown tab on the left and the factory board on
the right, half and half. The keys and the tabs are the same as in the personal layout. Go to the
space `factory` to talk to the coordinator, or to the tab of a task to talk to its agent.

The banner over the tab names who you talk to, in your UI font: COORDINATOR, WORKER, or DESIGN with
the task, each in its own accent of the theme (`ansi5`, `ansi6`, `ansi3`). On other tabs it is one
dim line. "← coordinator" goes back to the coordinator.

The board (`mods/factory-board`):

- **Power**: shows if factoryd and the coordinator run. "start" runs `factory up`, "stop" runs
  `factory down`.
- **Tasks**: "needs you", then a lane for each status. A card shows the status, the title, the
  folder (hover for the full path), and the agent. Click a task to go to its agent, or to start it
  (`factory open <id>`).
- **Inbox**: one card for each thread, with the author, the state, and the text of the newest event.
  Filter by source. Click a card to open it in the browser. "design →" makes a sketch task and
  starts a design agent (`factory inbox design`). "dismiss" / "resolve" asks first, then marks the
  GitHub notification done or resolves the Sentry issue (`factory inbox dismiss`).
- The source health and the feed.

When the board is wide, the tasks are on the left and the inbox is on the right, with as many card
columns as fit.

The board runs `bun packages/factory/src/cli.ts` in this repository. It loads the board when the
ledger changes, after each action, and every 20 seconds. It finds the repository through the link of
its mod folder. Layout props `repo` and `factoryHome` override the repository and the ledger. With
the prop `boardFile`, it reads the board from a JSON file and only logs the actions (for
development; see `tests/mods/factory-board/fixtures`). The banner is the same mod with the prop
`view: "banner"`; give it the same `factoryHome`.

## Panes

`mods/pane-quiet` draws the program name, the folder, and the agent state in dim colors. The split,
zoom, and close buttons show while the pointer is on the pane. The focused pane has a rim of 17%
white (`#ffffff2b`). Change it in `layouts/michaelhelvey.json`: `pane.focus.color`.

## Font

`settings.json` uses the `MonoLisaCode Herdr` font family. Herdr reads it from
`~/.config/herdr-app/fonts`. Without it, Herdr uses a fallback font.

## Keys

Press Ctrl+F, then:

- `%` / `"`: split right / down.
- `h j k l`: move focus. `o`: next pane. `;`: last pane in this tab.
- `c`: new tab. `n p`: next / previous tab. `1–9`, `0`: select a tab.
- `t`: find work. `b`: show or hide spaces and agents.
- `z`: zoom a pane. `x`: close a pane. `J K`: next / previous space.
- Ctrl+F: send a literal Ctrl+F. Escape: cancel.

Cmd+1 through Cmd+9 select spaces. Ctrl+Shift+J / Ctrl+Shift+K zoom the app in / out.

The prefix mod runs `hc keys` only to send a literal prefix.

## Checks

```sh
bun test packages/herdr
herdr-app check ~/.config/herdr-app/mods/herdr-tabs
uv run packages/herdr/scripts/check-tab-spacing.py --x 500
```

For the spacing check, choose an x coordinate through the flat part of a visible tab tray.
