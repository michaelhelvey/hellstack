# pstack

You have the pstack skills. Load the `poteto-mode` skill and follow its instructions when a task
meets one of these conditions:

- It touches more than one file, or changes a signature that other files call.
- It involves a design or architecture choice.
- It is a bug whose cause is not known yet, or a performance issue.

poteto-mode routes to the correct pstack skill from there. For smaller tasks, such as a contained
change to one file with an obvious test, a question, or a one-line edit, do the work directly and
verify it on the real artifact. When the user names a pstack skill, load that skill directly.

pstack skills use Claude Code tool words. Read `references/amp-tools.md` in the poteto-mode skill
for the Amp equivalent of each tool.

## pstack models

The pstack skills name models by role and by alias. On Amp, you select a model with the `agent_mode`
of `create_thread`. Use these agent modes. Each one is pinned to the models that the user selected.

| Alias or role                                     | `agent_mode`        | Main model          |
| ------------------------------------------------- | ------------------- | ------------------- |
| `opus`, feature, refactoring, judgment and prose  | `chinchilla-high`   | Qwen3.8 Max         |
| `fable`, strongest judgment, bug-fix, perf, climb | the `oracle` tool   | Qwen3.8 Max         |
| `sonnet`                                          | `chinchilla-medium` | GLM-5.3             |
| `haiku`, routine or mechanical work               | `chinchilla-low`    | DeepSeek V4.1 Flash |
| Any other vendor's model, for example a GPT model | `chinchilla-ultra`  | Grok 4.7            |
| Default                                           | `chinchilla-high`   | Qwen3.8 Max         |

When a skill names a panel of models, start one thread for each entry with the mode in this table.
Use the `oracle` tool for a role that the table maps to it, and only `create_thread` with a mode in
this table. Do not use another agent mode for `create_thread`.

## Skill scripts

Amp's skill cache does not keep the executable bit of skill files. Before you run a script from a
skill, run `chmod +x` on the files in the `scripts` directory of that skill.

## Threads that you start

When you start a thread with `create_thread` for any reason, set `agent_mode` to a mode in the table
above. Use `chinchilla-medium` when no role applies.
