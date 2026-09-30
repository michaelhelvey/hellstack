import { Plugin } from "@opencode-ai/plugin";

/** Adds the `get_current_model` tool, which returns the provider, model, and thinking level of the session. */
export default Plugin.define({
  id: "local.get-current-model",
  setup: async (ctx) => {
    await ctx.tool.transform((tools) => {
      tools.add({
        name: "get_current_model",
        description:
          "Get the provider, model, and thinking level currently selected for this session",
        input: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: {
            provider: { type: "string" },
            model: { type: "string" },
            thinking: { type: ["string", "null"] },
            display: { type: "string" },
          },
          required: ["provider", "model", "thinking", "display"],
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (_input, toolCtx) => {
          const session = await ctx.session.get({ sessionID: toolCtx.sessionID });
          if (!session.model) throw new Error("The session does not have a model selected");

          const { providerID: provider, id: model, variant: thinking } = session.model;
          const display = `${provider}/${model}${thinking ? ` (thinking: ${thinking})` : ""}`;

          return {
            output: { provider, model, thinking: thinking ?? null, display },
            content: display,
          };
        },
      });
    });
  },
});
