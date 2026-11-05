import { View, div } from "gpui-kit";
import { closeOverlay, focused, hc, nextCommand, panes, props, run, shared, theme } from "herdr";
import { actionFor, targetPane } from "./bindings.js";
import { menu } from "./menu.js";

/** A one-key command menu for the Ctrl+F prefix. */
export default class Prefix extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => {
      for (;;) {
        await nextCommand();
        this.sendPrefix(cx);
      }
    });
  }

  dismiss() {
    closeOverlay(props().overlay);
  }

  sendPrefix(cx) {
    const terminal = focused()?.terminal;
    if (!terminal) return this.dismiss();
    const pending = hc(["keys", terminal, "ctrl+f"]);
    cx.spawn(async () => {
      const result = await pending;
      if (result.code !== 0) console.log(result.stderr);
    });
    this.dismiss();
  }

  dispatch(action) {
    if (!action) return;
    const [, command, args = {}] = action;
    if (command.endsWith("-pane")) return this.focusPane(command);
    run(command, args);
  }

  focusPane(command) {
    const pane = targetPane(command, panes(), focused(), shared("pane.history") ?? {});
    if (pane) run("pane.focus", { pane });
  }

  key(event, cx) {
    cx.stop_propagation();
    if (event.modifiers.control && event.key === "f") return this.sendPrefix(cx);
    this.dismiss();
    this.dispatch(actionFor(event));
  }

  render() {
    return div()
      .id("prefix")
      .size_full()
      .track_focus(this.handle)
      .on_key_down((event, cx) => this.key(event, cx))
      .child(
        menu(
          theme(),
          (key) => {
            this.dismiss();
            this.dispatch(actionFor({ key, key_char: key, modifiers: {} }));
          },
          (_event, cx) => this.sendPrefix(cx),
        ),
      );
  }
}
