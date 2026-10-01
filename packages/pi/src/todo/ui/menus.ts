import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, type SelectItem, Text } from "@earendil-works/pi-tui";
import { z } from "zod";

import { formatTodoId } from "../ids.ts";
import { getTodoTitle, isTodoClosed, type TodoRecord } from "../model.ts";
import { accentBorder, addChildren, selectListTheme } from "./shared.ts";

const TodoMenuActionSchema = z.enum([
  "view",
  "work",
  "refine",
  "close",
  "reopen",
  "release",
  "copyPath",
  "copyText",
  "delete",
]);

/** An action that the user can select for a todo. */
export type TodoMenuAction = z.infer<typeof TodoMenuActionSchema>;

class SelectMenu extends Container {
  private readonly selectList: SelectList;

  constructor(theme: Theme, title: string, items: SelectItem[]) {
    super();
    this.selectList = new SelectList(items, items.length, selectListTheme(theme));
    addChildren(this, [
      accentBorder(theme),
      new Text(title),
      this.selectList,
      new Text(theme.fg("dim", "Enter to confirm • Esc back")),
      accentBorder(theme),
    ]);
  }

  protected onSelect(handler: (value: string) => void, onCancel: () => void): void {
    this.selectList.onSelect = (item) => handler(item.value);
    this.selectList.onCancel = onCancel;
  }

  handleInput(keyData: string): void {
    this.selectList.handleInput(keyData);
  }
}

function actionItems(todo: TodoRecord): SelectItem[] {
  const closed = isTodoClosed(todo.status);

  return [
    { value: "view", label: "view", description: "View todo" },
    { value: "work", label: "work", description: "Work on todo" },
    { value: "refine", label: "refine", description: "Refine task" },
    closed
      ? { value: "reopen", label: "reopen", description: "Reopen todo" }
      : { value: "close", label: "close", description: "Close todo" },
    ...(todo.assigned_to_session
      ? [{ value: "release", label: "release", description: "Release assignment" }]
      : []),
    { value: "copyPath", label: "copy path", description: "Copy absolute path to clipboard" },
    { value: "copyText", label: "copy text", description: "Copy title and body to clipboard" },
    { value: "delete", label: "delete", description: "Delete todo" },
  ];
}

/** Callbacks of {@link TodoActionMenu}. */
export interface TodoActionMenuHandlers {
  onSelect: (action: TodoMenuAction) => void;
  onCancel: () => void;
}

/** A menu of the actions for one todo. */
export class TodoActionMenu extends SelectMenu {
  /** Makes the menu for `todo`. */
  constructor(theme: Theme, todo: TodoRecord, handlers: TodoActionMenuHandlers) {
    const title = `Actions for ${formatTodoId(todo.id)} "${getTodoTitle(todo)}"`;
    super(theme, theme.fg("accent", theme.bold(title)), actionItems(todo));
    this.onSelect(
      (value) => handlers.onSelect(TodoMenuActionSchema.parse(value)),
      handlers.onCancel,
    );
  }
}

/** A yes or no question. Cancel is the same as "no". */
export class ConfirmMenu extends SelectMenu {
  /** Makes a question with the text `message`. */
  constructor(theme: Theme, message: string, onConfirm: (confirmed: boolean) => void) {
    const items = [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ];

    super(theme, theme.fg("accent", message), items);
    this.onSelect(
      (value) => onConfirm(value === "yes"),
      () => onConfirm(false),
    );
  }
}
