import type { ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";

/** The part of the shared editor that a feature can use. */
export interface EditorHost {
  /** The key bindings of pi. */
  readonly keys: KeybindingsManager;
  /** True when the editor has the focus. */
  readonly focused: boolean;
  getLines(): string[];
  getCursor(): { line: number; col: number };
  insertTextAtCursor(text: string): void;
  isShowingAutocomplete(): boolean;
  /** Sends keys to the editor. The features do not get these keys. */
  input(data: string): void;
  /** Opens the autocomplete menu for the text at the cursor. */
  triggerAutocomplete(): void;
  requestRender(): void;
}

/** A part of the behavior of the shared editor. All methods are optional. */
export interface EditorFeature {
  /** Gets each key before the editor. Return true to stop the key. */
  handleInput?(data: string): boolean;
  /** Gets each key after the editor used it. */
  afterInput?(data: string): void;
  /** Makes the lines to show above the editor. The editor calls it only when it has the focus. */
  render?(width: number): string[];
  /** Gets a mouse event on the lines of this feature. `y` starts at the first line of the feature. */
  handleMouse?(event: TuiMouseEvent): void;
}

/** Makes a feature for one editor. Pi makes a new editor each time that a session starts. */
export type EditorFeatureFactory = (ctx: ExtensionContext, editor: EditorHost) => EditorFeature;
