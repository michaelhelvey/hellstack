/** Keep the two most recent panes for each tab. */
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
