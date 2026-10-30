# Build the lever

When the work isn't trivial, build a tool that deterministically drives it rather than doing it by
hand.

- Scripts live in a project-specific scripts directory. Consult with the user for where this is, if
  you're not sure. Likely locations might be in `./scripts`, or
  `./agents/skills/verify-<project>/scripts`, etc.
- Work that outlives the current session should be git-tracked.
- Work that requires non-determinism, judgement, etc (e.g. an agent) should go into a project-local
  skill. Add to one if it exists already, or create a new one.
- Scripts need to be accessible/findable by agents. Don't orphan a script into a `scripts` dir
  without a reference in an agent skill or other agent accessible documentation that can be used to
  drive it.

## Rules

Ultimately the goal is that you, or other agents, should always be able to "drive" the current
project / feature / bug-fix / test with code that is as deterministic as possible.
