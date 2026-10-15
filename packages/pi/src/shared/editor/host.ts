import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";

import type { EditorFeature, EditorHost } from "./feature.ts";

interface Slot {
  feature: EditorFeature;
  /** The number of lines that the feature showed in the last render. */
  height: number;
}

/**
 * The pi editor with the features of all hellstack extensions. The features get each key before
 * the editor, and show their lines above the editor in the order of the list.
 */
export class HellstackEditor extends CustomEditor implements EditorHost {
  readonly keys: KeybindingsManager;
  readonly #slots: Slot[];

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    features: ReadonlyArray<(editor: EditorHost) => EditorFeature>,
  ) {
    super(tui, theme, keybindings, { embedWorkingStatus: true });
    this.keys = keybindings;
    this.#slots = features.map((make) => ({ feature: make(this), height: 0 }));
  }

  override handleInput(data: string): void {
    if (this.#slots.some(({ feature }) => feature.handleInput?.(data) === true)) return;
    super.handleInput(data);
    for (const { feature } of this.#slots) feature.afterInput?.(data);
  }

  override render(width: number): string[] {
    const editor = super.render(width);
    const above = this.#slots.flatMap((slot) => {
      const lines = this.focused ? (slot.feature.render?.(width) ?? []) : [];
      slot.height = lines.length;
      return lines;
    });

    return [...above, ...editor];
  }

  override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    let top = 0;
    for (const slot of this.#slots) {
      if (event.y < top + slot.height) {
        slot.feature.handleMouse?.({ ...event, y: event.y - top });
        return { handled: true, focus: true };
      }
      top += slot.height;
    }

    return super.handleMouse({ ...event, y: event.y - top });
  }

  input(data: string): void {
    super.handleInput(data);
  }

  triggerAutocomplete(): void {
    // `Editor` keeps this method private, but no public method opens the menu for a typed key.
    const trigger: unknown = Reflect.get(this, "tryTriggerAutocomplete");
    if (typeof trigger === "function") trigger.call(this);
  }

  requestRender(): void {
    this.tui.requestRender();
  }
}
