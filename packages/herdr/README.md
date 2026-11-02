# @hellstack/herdr

Personal layouts, mods, keys, and themes for the [Herdr](https://herdr.dev/download/) desktop app.

`bun run sync` in the repository root links each file in [`config`](./config) into
`~/.config/herdr-app`. Set `HERDR_APP_DIR` to use a different folder. Herdr writes its own files in
that folder, so the script makes real folders and links only the files. A mod folder is linked as
one unit. When Herdr writes a real file over a link, the next sync moves that file to `<name>.bak`.

## Layouts

Select the personal layout with `herdr-app do layout.switch --name herdr`. It has the space picker
and tabs across the top. The sidebar starts hidden; Ctrl+F then B shows the spaces and agents. The
file and change icons open the standard Herdr panels.

The native macOS window buttons are outside the visible window (`traffic_lights: [-100, 16]`). Use
the macOS menus or keyboard shortcuts for window controls.

The tmux-style layout is `herdr-app do layout.switch --name tmux`.

## Panes

`mods/pane-quiet` draws the program name, the folder, and the agent state in dim colors. The split,
zoom, and close buttons show while the pointer is on the pane. The focused pane has a rim of 17%
white (`#ffffff2b`). Change it in `layouts/herdr.json`: `pane.focus.color`.

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

The prefix mod runs `hc keys` only to send a literal prefix. The status mod runs
`git status --porcelain` in the folder of the focused terminal every five seconds.

## Checks

```sh
bun test packages/herdr
herdr-app check ~/.config/herdr-app/mods/herdr-tabs
uv run packages/herdr/scripts/check-tab-spacing.py --x 500
```

For the spacing check, choose an x coordinate through the flat part of a visible tab tray.
