import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { EditorFeature, EditorHost } from "../shared/editor/feature.ts";
import { registerEditorFeature } from "../shared/editor/register.ts";
import { skillAutocomplete, slashToken } from "./autocomplete.ts";
import { expandSkills, type SkillCommand, skillCommands } from "./skills.ts";

const TOKEN_KEY = /^[\w/-]$/;

function inSkillToken(editor: EditorHost): boolean {
  const { line, col } = editor.getCursor();

  return slashToken(editor.getLines(), line, col)?.atStart === false;
}

/** Opens the autocomplete menu when the user types a `/name` token after the start of a line. */
function skillMenu(editor: EditorHost): EditorFeature {
  return {
    afterInput(data) {
      const typed = TOKEN_KEY.test(data) && !editor.isShowingAutocomplete();
      if (typed && inSkillToken(editor)) editor.triggerAutocomplete();
    },
  };
}

/**
 * Lets the user start a skill with `/name`, not only with `/skill:name`. The token can be
 * anywhere in the prompt, and a prompt can start more than one skill.
 */
export default function skillCommandsExtension(pi: ExtensionAPI): void {
  function skills(): SkillCommand[] {
    return skillCommands(pi.getCommands());
  }

  pi.on("input", async (event) => {
    const text = await expandSkills(event.text, skills());
    return text === undefined ? { action: "continue" } : { action: "transform", text };
  });
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui") ctx.ui.addAutocompleteProvider(skillAutocomplete(skills));
  });
  registerEditorFeature(pi, "skill-commands", (_ctx, editor) => skillMenu(editor));
}
