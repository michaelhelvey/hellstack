# Chinchilla Mode

How to build software with me. These rules apply to all work, in all languages, for every agent:
the coordinator, design agents, workers, and their sub-agents. When a rule changes a decision that
you make, say which rule you applied and why.

## Complexity is a demon

- All code is tech debt. The less of it you have to write, the better.
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
  external JSON API contract? Check with me before you refactor it. Refactoring one internal
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
- When you write a task whose outcome is a bug fix, its verification is the reproduction: a test,
  script, or command that fails now and passes after the fix. When you work on such a task, the
  reproduction is your first deliverable. Then tell me: how you reproduced it, the root cause, how
  you fixed it, and how I can see the fix.

## Build the lever

When the work is not trivial, build a tool that deterministically drives it. Do not do it by hand.

- Put scripts in a project-specific scripts directory. If you are not sure where this is, ask.
  Likely locations are `./scripts`, `./agents/skills/verify-<project>/scripts`, and similar.
- Work that outlives the current session must be git-tracked.
- Work that needs non-determinism or judgement (for example, an agent) belongs in a project-local
  skill. Add to an existing skill, or create a new one.
- Agents must be able to find the scripts. Do not orphan a script in a `scripts` directory. Add a
  reference to it in an agent skill, or in other agent-accessible documentation that drives it.
- The goal is that you, or other agents, can always drive the current project, feature, bug fix, or
  test with code that is as deterministic as possible.

## Prove it works

- Tests are good. Write tests, e2e where possible. This rule does not discourage automated testing.
- Tests are not enough. Figure out how to drive your feature in a real-world scenario with 0 mocks,
  locally if you can and remotely if you must, to verify that it actually works.
- Tell me how to verify the work. What must I do to replicate what you did? Give specific
  instructions: run this script, run this SQL, click this link, and so on. Pretend I am a QA
  engineer who has no idea how the software works, and only has to verify the change.

## Protect your time

Whenever you run a command or build a workflow, optimize how long it takes, and set aggressive
timeouts so that nothing runs too long.

- Do targeted searches with `fff`. Do not `grep` or `find` over large parts of the file system if
  you can find the thing you are looking for another way.
- A test suite is only valuable if you can run it quickly and often. Running it quickly and
  efficiently across many parallel agents is as important as correctness.
- Always use `timeout` on the commands that you run. If something takes too long, optimize it.

## Tasks

A good task has four things. When you write a task, or receive one, make sure that it has them:

1. **Goal**: the observable end state of the system, not the steps.
2. **Verification**: a deterministic way to prove that it is done and works.
3. **Output**: what I want to see at the end (a demo, a report, a URL, a screenshot).
4. **Constraints**: infrastructure, libraries, permissions, and anything else the work must respect.

It also says how it **lands**: the ordered steps that take the work out of the agent's hands (a
local commit, a merged PR, a release). LLMs cannot read my mind. If the task is bad, the result is
bad, so fix the task first.

## TypeScript

- Never use `any` to resolve type system errors. The only acceptable use of `any` is in a generic
  to perform inference (e.g. `type T<R> = R extends (...args: any[]) => any ? ...`).
- External data is always `unknown`, never `any`.
- Identify the schema validation library in use by the project (zod, valibot, effect/Schema, etc),
  and use it for all input validation. Never naively cast (`JSON.parse(data) as SomeType`). Every
  cast is a bug waiting to happen.
- Do not write out types yourself when you can infer them from the schema library (e.g. `z.infer`,
  `Schema.Type`).
- Use `Pick/Omit/Parameters/ReturnType` to derive a new type before creating a new, overlapping
  type.
- Use the type system to make incorrect states impossible to represent. For example, model variants
  with a `kind` or `type` literal discriminant. Never create optional-field bags.
- Add readable whitespace within code. I do not want to read 10 lines of code smushed together.
- Add logging and telemetry when you write code, with the conventions of the project. Code that you
  cannot diagnose in production is broken code.
- Write doc comments with usage examples for public exports from a module. Never write
  non-doc-comments within the code.

## Rust

- Add readable whitespace within code.
- Add logging and telemetry when you write code, with the conventions of the project.
- Avoid dynamic dispatch when at all possible, unless the user or the constraints of the project
  require it (e.g. a library that must call a user-provided trait implementation). Default to
  `enum_dispatch` to express polymorphism.
- Use `thiserror` within modules to clearly express the error boundaries of that module. Do not let
  error types leak everywhere. Use `anyhow` only at top-level boundaries.
- Exclude the features of external crates that you do not need, to make compilation faster.
- Write doc comments with examples that run with `cargo test` for public traits, methods, and
  functions. Do not write non-doc-comments within code.
