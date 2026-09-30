import path from "node:path";

import {
  copyToClipboard,
  type ExtensionCommandContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";

import { formatTodoId } from "../ids.ts";
import { getTodoTitle, type TodoFrontMatter, type TodoRecord } from "../model.ts";
import { buildRefinePrompt, buildWorkPrompt } from "../render.ts";
import type { TodoResult, TodoStore } from "../store.ts";
import { TodoDetailOverlay, type TodoOverlayAction } from "./detail-overlay.ts";
import { ConfirmMenu, TodoActionMenu, type TodoMenuAction } from "./menus.ts";
import { TodoSelector } from "./selector.ts";
import type { KeybindingMatcher } from "./shared.ts";

type ActiveComponent = Component & Partial<Focusable>;

type MenuHandler = (todo: TodoRecord) => Promise<void> | void;

/** The environment of a {@link TodoManager}. */
export interface TodoManagerOptions {
  tui: TUI;
  theme: Theme;
  keybindings: KeybindingMatcher;
  ctx: ExtensionCommandContext;
  store: TodoStore;
  todos: TodoFrontMatter[];
  searchTerm: string;
  /** Closes the manager. A prompt goes into the editor. */
  done: (prompt: string | undefined) => void;
}

function clipboardText(todo: TodoRecord): string {
  const body = todo.body.trim();
  const heading = `# ${getTodoTitle(todo)}`;
  return body ? `${heading}\n\n${body}` : heading;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The root component of the `/todos` UI. It shows the todo selector, the action menu of a todo,
 * or the delete confirmation, and sends keyboard input to the component that shows.
 */
export class TodoManager implements Component, Focusable {
  private readonly selector: TodoSelector;
  private active: ActiveComponent;
  private actionMenu: TodoActionMenu | undefined;
  private isFocused = false;

  private readonly menuHandlers: Record<TodoMenuAction, MenuHandler> = {
    view: (todo) => this.view(todo),
    work: (todo) => this.options.done(buildWorkPrompt(todo)),
    refine: (todo) => this.options.done(buildRefinePrompt(todo)),
    close: (todo) => this.apply(this.options.store.update(todo.id, { status: "closed" }), "Closed"),
    reopen: (todo) =>
      this.apply(this.options.store.update(todo.id, { status: "open" }), "Reopened"),
    release: (todo) => this.apply(this.options.store.release(todo.id, true), "Released"),
    delete: (todo) => this.confirmDelete(todo),
    copyPath: (todo) => this.copyPath(todo),
    copyText: (todo) => this.copy(clipboardText(todo), "Copied todo text to clipboard"),
  };

  /** Makes the manager and shows the todo selector. */
  constructor(private readonly options: TodoManagerOptions) {
    const { tui, theme, keybindings, todos, searchTerm, store } = options;
    this.selector = new TodoSelector({
      tui,
      theme,
      keybindings,
      todos,
      initialSearch: searchTerm,
      currentSessionId: store.session.id,
      onSelect: (todo) => this.run(this.showActionMenu(todo)),
      onCancel: () => options.done(undefined),
      onQuickAction: (todo, action) =>
        options.done(action === "work" ? buildWorkPrompt(todo) : buildRefinePrompt(todo)),
    });
    this.active = this.selector;
  }

  /** True when the manager has keyboard focus. The active component gets the same focus. */
  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
    this.active.focused = value;
  }

  render(width: number): string[] {
    return this.active.render(width);
  }

  invalidate(): void {
    this.active.invalidate();
  }

  handleInput(data: string): void {
    this.active.handleInput?.(data);
  }

  private setActive(component: ActiveComponent): void {
    this.active.focused = false;
    this.active = component;
    this.active.focused = this.isFocused;
    this.options.tui.requestRender();
  }

  private run(task: Promise<void> | void): void {
    void Promise.resolve(task).catch((error: unknown) => {
      this.options.ctx.ui.notify(errorMessage(error), "error");
    });
  }

  private async showActionMenu(todo: TodoFrontMatter): Promise<void> {
    const result = await this.options.store.get(todo.id);
    if ("error" in result) {
      this.options.ctx.ui.notify(result.error, "error");
      return;
    }
    const record = result.todo;
    this.actionMenu = new TodoActionMenu(this.options.theme, record, {
      onSelect: (action) => this.run(this.menuHandlers[action](record)),
      onCancel: () => this.setActive(this.selector),
    });
    this.setActive(this.actionMenu);
  }

  private async view(todo: TodoRecord): Promise<void> {
    const action = await this.options.ctx.ui.custom<TodoOverlayAction>(
      (tui, theme, keybindings, done) =>
        new TodoDetailOverlay({ tui, theme, keybindings, todo, onAction: done }),
      { overlay: true, overlayOptions: { width: "80%", maxHeight: "80%", anchor: "center" } },
    );
    if (action === "work") this.options.done(buildWorkPrompt(todo));
    else this.setActive(this.actionMenu ?? this.selector);
  }

  private confirmDelete(todo: TodoRecord): void {
    const message = `Delete todo ${formatTodoId(todo.id)}? This cannot be undone.`;
    const confirm = new ConfirmMenu(this.options.theme, message, (confirmed) => {
      if (confirmed) this.run(this.apply(this.options.store.delete(todo.id), "Deleted"));
      else this.setActive(this.actionMenu ?? this.selector);
    });
    this.setActive(confirm);
  }

  private async apply(pending: Promise<TodoResult>, verb: string): Promise<void> {
    const result = await pending;
    if ("error" in result) {
      this.options.ctx.ui.notify(result.error, "error");
    } else {
      this.selector.setTodos(await this.options.store.list());
      this.options.ctx.ui.notify(`${verb} todo ${formatTodoId(result.todo.id)}`, "info");
    }
    this.setActive(this.selector);
  }

  private copyPath(todo: TodoRecord): Promise<void> {
    const absolutePath = path.resolve(this.options.store.pathFor(todo.id));
    return this.copy(absolutePath, `Copied ${absolutePath} to clipboard`);
  }

  private async copy(text: string, message: string): Promise<void> {
    try {
      await copyToClipboard(text);
      this.options.ctx.ui.notify(message, "info");
    } catch (error) {
      this.options.ctx.ui.notify(errorMessage(error), "error");
    }
    this.setActive(this.selector);
  }
}
