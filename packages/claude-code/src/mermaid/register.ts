import { render } from "grok-mermaid";

import { drawMermaid } from "./transform.ts";

/** The columns that the transcript uses for the bullet in front of a reply. */
const replyIndent = 2;

/** The terminal width to use when the surface does not give one. */
const defaultColumns = 80;

/** The part of a `ui.render` event for an `AssistantMessage` that this mod reads. */
export interface AssistantMessageRender {
  props: { text: string };
  viewport?: { columns: number };
}

/** The part of the Claude Code `on` function that this mod uses. */
export type On = (
  event: "ui.render",
  matcher: { component: "AssistantMessage" },
  hook: (
    $: unknown,
    e: AssistantMessageRender,
    next: (e: AssistantMessageRender) => unknown,
  ) => unknown,
) => void;

/** Registers the hook that draws Mermaid code blocks in assistant replies as Unicode art. */
export function register(on: On): void {
  on("ui.render", { component: "AssistantMessage" }, (_$, e, next) => {
    const width = (e.viewport?.columns ?? defaultColumns) - replyIndent;
    return next({ ...e, props: { ...e.props, text: drawMermaid(e.props.text, render, width) } });
  });
}
