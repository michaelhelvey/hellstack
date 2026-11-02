function nativeControls(window) {
  return window?.platform === "macos" && window.titlebar === "none" && !window.fullscreen;
}

/** Keep the title after the native macOS window buttons at every app zoom level. */
export function titlePadding(window, zoom, lights) {
  if (!nativeControls(window)) return 14;
  return Math.max(14, ((lights?.[0] ?? 12) + 64 + 8) / zoom);
}

function childrenOf(node) {
  return node?.children ?? [];
}

/** Find a node in a layout tree. */
export function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of childrenOf(node)) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/** Keep pane history in the format used by tmux-status. Mods have separate module roots. */
export function rememberPane(history, pane) {
  if (!pane || history[pane.tab]?.[0] === pane.pane) return history;
  return {
    ...history,
    [pane.tab]: [pane.pane, ...(history[pane.tab] ?? []).filter((id) => id !== pane.pane)].slice(
      0,
      2,
    ),
  };
}
