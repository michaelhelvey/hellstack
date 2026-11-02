/** The keys after Ctrl+F and their Herdr commands. */
export const bindings = {
  c: ["New tab", "tab.new"],
  "%": ["Split right", "pane.split", { direction: "right" }],
  '"': ["Split down", "pane.split", { direction: "down" }],
  h: ["Focus left", "pane.go", { direction: "left" }],
  j: ["Focus down", "pane.go", { direction: "down" }],
  k: ["Focus up", "pane.go", { direction: "up" }],
  l: ["Focus right", "pane.go", { direction: "right" }],
  left: ["Focus left", "pane.go", { direction: "left" }],
  down: ["Focus down", "pane.go", { direction: "down" }],
  up: ["Focus up", "pane.go", { direction: "up" }],
  right: ["Focus right", "pane.go", { direction: "right" }],
  o: ["Next pane", "next-pane"],
  ";": ["Last pane", "last-pane"],
  t: ["Jump to work", "mod.open", { name: "picker" }],
  n: ["Next tab", "tab.next"],
  p: ["Previous tab", "tab.prev"],
  z: ["Zoom pane", "pane.zoom"],
  x: ["Close pane", "pane.close"],
  b: ["Toggle agents sidebar", "layout.toggle", { id: "sidebar" }],
  J: ["Next space", "space.next"],
  K: ["Previous space", "space.prev"],
  d: ["Minimize window", "window.minimize"],
};

function tabIndex(key) {
  return key === "0" ? 10 : Number(key);
}

function shiftedKey(event) {
  return event.modifiers.shift ? event.key.toUpperCase() : event.key;
}

/** Find an action from a key event. Modified keys do not run plain-key actions. */
export function actionFor(event) {
  const m = event.modifiers;
  if ([m.control, m.alt, m.platform].some(Boolean)) return undefined;
  const key = event.key_char ?? shiftedKey(event);
  if (/^[0-9]$/.test(key)) return ["Select tab", "tab.select", { index: tabIndex(key) }];
  return bindings[key];
}

/** Find the next pane in layout order, or the last pane used in this tab. */
export function targetPane(command, panes, focus, history) {
  const list = panes.filter((p) => p.tab === focus?.tab);
  if (command === "last-pane") return list.find((p) => p.pane === history[focus?.tab]?.[1])?.pane;
  const index = list.findIndex((p) => p.pane === focus?.pane);
  return list[(index + 1) % list.length]?.pane;
}
