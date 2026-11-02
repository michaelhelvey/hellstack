# General principles

The traits below apply to all work, in all languages.

## Complexity is a demon

- All code is tech debt. The less of it you have to write the better.
- Every conditional is a source of bugs.
- Every edge case that you dream up that does not happen in the real world is a source of bugs.
- Fail fast. Write asserts, not conditionals, to handle edge cases. An assert that `{X}` is not
  supported, with a clear error message, is correct behavior if we do not need to support `{X}` now.
- Nested code is evil. Flat code is good.
- Good code comes from good data structures. If you have to write many conditionals, your data
  structures are bad. Design your domain so that incorrect states are impossible to represent.
  Simple code then follows naturally.

## Design from first principles

Goal: never "tack on" a feature such that the result is not a consistent, simple codebase.

- Every time you write code, ask how it **should** work if this were a greenfield project.
- The one exception is a change to the external, customer-facing part of the software. Changing the
  external JSON API contract? Check with the user before you refactor it. Refactoring one internal
  interface so that the 3 other callers no longer leak implementation details? Fix it, and do not
  worry about backwards compatibility.
- Proactively ask where the **boundaries** of the module are. Do not let details leak out of the
  boundary. Refactor so that boundaries are strong and simple.
- Create "deep modules", as John Ousterhout puts it. The interface is simple, even when the
  implementation is complex. A shallow module has a wide, complex interface that maps directly onto
  its complex implementation. A deep module has a simple, narrow interface that hides its complex
  implementation. Fight against features that widen the interface.

## Fix the root cause

- Every time you fix something, find out _why_ it happened, and fix the root cause.
- _Why_ means that you have a deterministic way to reproduce the bug. Never fix something
  speculatively. Reproduce, fix, verify.
- Do not "spot fix", that is, do not fix one instance of the bug without understanding the broader
  pattern.
- Proactively find other places in the application where this bug, or the pattern that produced it,
  can occur. Fix them too.

## Build the lever

When the work is not trivial, build a tool that deterministically drives it. Do not do it by hand.

- Put scripts in a project-specific scripts directory. If you are not sure where this is, ask the
  user. Likely locations are `./scripts`, `./agents/skills/verify-<project>/scripts`, and similar.
- Work that outlives the current session must be git-tracked.
- Work that needs non-determinism or judgement (for example, an agent) belongs in a project-local
  skill. Add to an existing skill, or create a new one.
- Agents must be able to find the scripts. Do not orphan a script in a `scripts` directory. Add a
  reference to it in an agent skill, or in other agent-accessible documentation that drives it.
- The goal is that you, or other agents, can always drive the current project, feature, bug fix, or
  test with code that is as deterministic as possible.

## Prove it works

- Tests are good. Write tests, e2e where possible. This trait does not discourage automated testing.
- Tests are not enough. Figure out how to drive your feature in a real-world scenario with 0 mocks,
  locally if you can and remotely if you must, to verify that it actually works.
- Tell the user how to verify the work. What must the user do to replicate what you did? Give
  specific instructions: run this script, run this SQL, click this link, and so on. Pretend the user
  is a QA engineer who has no idea how the software works, and only has to verify the change.

## Protect your time

Whenever you run a command or build a workflow, optimize how long it takes, and set aggressive
timeouts so that nothing runs too long.

- Do targeted searches with `fff`. Do not `grep` or `find` over large parts of the file system if
  you can find the thing you're looking for another way.
- A test suite is only valuable if you can run it quickly and often. To run it quickly and
  efficiently across many parallel agents is as important as correctness.
- Always use `timeout` on the commands that you run. If something takes too long, optimize it.
