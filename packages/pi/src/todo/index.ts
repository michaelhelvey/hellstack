import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

import { formatTodoList } from "./render.ts";
import { getTodosDirLabel } from "./store.ts";
import { createTodoStore, createTodoTool } from "./tool.ts";
import { TodoManager, type TodoManagerOptions } from "./ui/manager.ts";

async function showTodoManager(
  ctx: ExtensionCommandContext,
  input: Pick<TodoManagerOptions, "store" | "todos" | "searchTerm">,
): Promise<void> {
  let rootTui: TUI | undefined;

  const prompt = await ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
    rootTui = tui;

    return new TodoManager({ ...input, tui, theme, keybindings, ctx, done });
  });

  if (!prompt) return;
  ctx.ui.setEditorText(prompt);
  rootTui?.requestRender();
}

async function runTodosCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const store = createTodoStore(ctx);
  const todos = await store.list();

  if (ctx.mode === "tui") await showTodoManager(ctx, { store, todos, searchTerm: args.trim() });
  else if (ctx.hasUI) ctx.ui.notify(formatTodoList(todos), "info");
  else console.log(formatTodoList(todos));
}

/**
 * Adds file-based todos. Each todo is a markdown file in `.pi/todos` (or in `PI_TODO_PATH`).
 * The `todo` tool lets the agent manage todos, and the `/todos` command opens a todo manager.
 */
export default function todos(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    const store = createTodoStore(ctx);
    await store.ensureDir();
    await store.collectGarbage();
  });

  pi.registerTool(createTodoTool(getTodosDirLabel(process.cwd())));

  pi.registerCommand("todos", {
    description: "List todos from .pi/todos",
    handler: runTodosCommand,
  });
}
