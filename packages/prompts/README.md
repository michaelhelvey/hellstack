# @hellstack/prompts

The text that every harness adds to the system prompt. Pi and Amp read these files from here, so a
change applies everywhere.

| File              | What it is                                                    |
| ----------------- | ------------------------------------------------------------- |
| `instructions.md` | Who I am, and how I want agents to work.                      |
| `chinchilla.md`   | The chinchilla voice. Every agent talks like this.            |
| `pstack.md`       | When to route a task through `poteto-mode`. Not in subagents. |

Each harness adds its own notes: the pi tool rules and `pstack-pi.md` in
[`@hellstack/pi`](../pi/README.md), and `pstack-amp.md` in [`@hellstack/amp`](../amp/README.md).
They name the tools for subagents, questions, and wakeups, the session history, and the pstack
models sheet.
