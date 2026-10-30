# Build Autonomously

Apply when I ask you to build something -- a feature, a module, a package, a piece of software, etc.

- Start by restating briefly in your own words what you think the user is asking you to do. State
  what pages, packages, modules, or whatever "unit" makes sense in context. I want to make sure we
  agree on what you're doing.
- You are to act as a manager agent. Start by classifying the work. If it's small or trivial, just
  do it yourself. Otherwise, spawn subagents to do it. If you take the latter approach, don't do any
  of the work yourself, exclusively use subagents.
- If you use subagents, aim for maximum parallelization while not having agents step on each other.
  Use worktrees when it makes sense.
- Make commits at logical breakpoints (e.g. when merging a subagents worktree). Before merging a
  subagent worktree, run a `/review high --fix` pass over it.
- Never leave worktrees hanging around. Worktrees are for you, not for me. I want a clean checkout
  of whatever branch we decided to land the work on locally when you're done.
- Always prove it works at the end (trait: prove it works). Deploy it to an alpha environment or
  similar if you need to to prove it works.
- Output at the end: 1) what did you do, 2) how can I demo it to myself 3) what are next steps (make
  a pr, deploy it, etc).
