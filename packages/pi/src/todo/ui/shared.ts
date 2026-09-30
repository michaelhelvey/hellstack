import {
  DynamicBorder,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { Container, SelectListTheme } from "@earendil-works/pi-tui";

/** The part of the keybindings manager that the todo UI uses. */
export type KeybindingMatcher = Pick<KeybindingsManager, "matches">;

/** A key test and the handler to run when the key matches. */
export type KeyBinding = readonly [matched: boolean, handler: () => void];

/** Runs the handler of the first matching key. Returns false if no key matches. */
export function dispatchKey(bindings: readonly KeyBinding[]): boolean {
  const binding = bindings.find(([matched]) => matched);
  binding?.[1]();
  return binding !== undefined;
}

/** Returns a full-width border in the accent color. */
export function accentBorder(theme: Theme): DynamicBorder {
  return new DynamicBorder((text: string) => theme.fg("accent", text));
}

/** Returns the select list colors of the todo UI. */
export function selectListTheme(theme: Theme): SelectListTheme {
  return {
    selectedPrefix: (text) => theme.fg("accent", text),
    selectedText: (text) => theme.fg("accent", text),
    description: (text) => theme.fg("muted", text),
    scrollInfo: (text) => theme.fg("dim", text),
    noMatch: (text) => theme.fg("warning", text),
  };
}

/** Adds each component to a container, in sequence. */
export function addChildren(
  container: Container,
  children: Parameters<Container["addChild"]>[0][],
): void {
  for (const child of children) container.addChild(child);
}
