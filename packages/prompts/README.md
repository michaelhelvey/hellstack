# @hellstack/prompts

The global instructions for pi. Pi loads one context file from the agent folder, so
[`AGENTS.md`](./AGENTS.md) holds everything that applies to every session, in every folder:

- Who I am, and how I want agents to write.
- The rules for the tools of pi.
- The chinchilla voice.

`bun run sync` in the repository root links `~/.pi/agent/AGENTS.md` to this file. Edit the file,
then type `/reload` in pi. Set `PI_CODING_AGENT_DIR` to use a different agent folder.

`AGENTS_FILE` is the path of the file. The install script uses it.
