import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { z } from "zod";

import type { EditorFeatureFactory } from "./feature.ts";
import { HellstackEditor } from "./host.ts";

const COLLECT_CHANNEL = "hellstack:editor:collect";

const CollectSchema = z.object({ features: z.instanceof(Map) });

function installEditor(pi: ExtensionAPI, ctx: ExtensionContext): void {
  if (ctx.mode !== "tui") return;
  const features = new Map<string, EditorFeatureFactory>();
  pi.events.emit(COLLECT_CHANNEL, { features });
  const makers = [...features.values()];

  ctx.ui.setEditorComponent(
    (tui, theme, keybindings) =>
      new HellstackEditor(
        tui,
        theme,
        keybindings,
        makers.map((make) => (editor) => make(ctx, editor)),
      ),
  );
}

/**
 * Adds a feature to the shared hellstack editor. Pi loads each extension in a different module
 * scope, so the extensions find the features of the others on the shared event bus. When a session
 * starts, each extension that has a feature sets an editor with the features of all extensions.
 * Thus the editor is the same if you turn off one of the extensions.
 */
export function registerEditorFeature(
  pi: ExtensionAPI,
  id: string,
  factory: EditorFeatureFactory,
): void {
  pi.events.on(COLLECT_CHANNEL, (data) => {
    CollectSchema.parse(data).features.set(id, factory);
  });
  pi.on("session_start", (_event, ctx) => installEditor(pi, ctx));
}
