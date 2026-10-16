/**
 * The environment variable that marks a subagent. `herdr-agents` sets it in each subagent pane.
 * Extensions read it to leave out the parts that only the main session needs.
 */
export const SUBAGENT_ENV = "HELLSTACK_SUBAGENT";
