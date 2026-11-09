# Finder angles

Each angle is a different way to find candidate findings in the diff. Do the angles that your level
tells you to do, in sequence. Each candidate has `file`, `line`, a one-line `summary`, and a
concrete `failure_scenario`.

## Correctness angles

### Angle A — Line-by-line diff scan

Read each hunk in the diff, line by line. Then read the enclosing function of each hunk. Bugs in
unchanged lines of a changed function are in scope, because the change shows them again or does not
fix them. For each line, ask: which input, state, timing, or platform makes this line incorrect?
Look for inverted or incorrect conditions, off-by-one, null or undefined dereference, missing
`await`, falsy-zero checks, copy-paste with the incorrect variable, errors caught and ignored, and
regex metacharacters without escapes.

### Angle B — Removed behavior

For each line that the diff deletes or replaces, name the invariant or behavior that the line
enforced. Then search the new code for the location where the new code enforces that invariant
again. If you cannot find it, that is a candidate: a removed guard, a removed error path, a
validation that accepts more than before, or a deleted test that examined a real case.

### Angle C — Cross-file tracer

For each function that the diff changes, search for its callers. Make sure that the change does not
break a call site: a new precondition, a different return shape, a new exception, or a new timing or
order dependency. Also examine the callees: does a different change in the same diff make a call
unsafe?

### Angle D — Language traps (`xhigh` and `max` only)

Look for the usual traps of the language and framework of the diff. For example: JavaScript falsy
zero, `==` coercion, a loop variable captured in a closure; Python mutable default arguments,
late-binding closures; Go writes to a nil map, captured range variables; SQL injection; time zone
and DST errors; float equality. Flag each one that the diff adds.

### Angle E — Wrapper and proxy correctness (`xhigh` and `max` only)

When the diff adds or changes a type that wraps a different type (cache, proxy, decorator, adapter),
make sure that each method sends calls to the wrapped instance, and not back through a registry,
session, or global. For example, a caching provider that has a `delegate` field but gets IDs with
`session.get(...)` instead of `delegate.get(...)` goes into the cache again, or recurses. Also make
sure that the wrapper forwards all the methods that the callers use.

## Cleanup angles

The angles above find bugs. The angles below find cleanups in the changed code.

### Reuse

Flag new code that does again something that the codebase already does. Search the shared and
utility modules, and the files near the change. Name the helper to call instead.

### Simplification

Flag unnecessary complexity that the diff adds: state that is redundant or that you can calculate,
copy-paste with small differences, deep nesting, dead code. Name the simpler form that does the same
work.

### Efficiency

Flag unnecessary work that the diff adds: calculations or I/O done more than one time, independent
operations done in sequence, blocking work added to startup or to hot paths. Also flag long-lived
objects made from closures or captured environments. They keep all of the enclosing scope in memory
while the object exists (a memory leak when that scope holds large values). Use a class or struct
that copies only the fields that it needs. Name the less expensive alternative.

## Altitude angle

### Altitude

Make sure that each change fixes the root cause at the correct level, and does not only hide a
symptom with a fragile patch. Special cases added to shared infrastructure show that the fix is not
deep enough. Prefer a simpler, more general change to the mechanism below. Name that change.

## Conventions angle

### Conventions

Find the agent instruction files that apply to the changed code:

- The user-level instructions in your system prompt.
- `AGENTS.md`, `CLAUDE.md`, and `CLAUDE.local.md` at the repository root.
- `AGENTS.md`, `CLAUDE.md`, and `CLAUDE.local.md` in each directory that contains a changed file,
  and in the parent directories of that directory. A file in a directory applies only to the files
  in that directory and its subdirectories.

Read each file that exists. Then find clear violations of their rules in the diff.

Flag a violation only when you can quote the exact rule and the exact line that breaks it. Do not
flag style preferences or vague guesses about the intent of the file. In the finding, give the path
of the instruction file and quote the rule. If no instruction file applies, this angle gives no
candidates.

## Candidates from cleanup, altitude, and conventions angles

These candidates use the same `file`, `line`, and `summary` fields. In `failure_scenario`, give the
concrete cost instead of a crash: what is duplicated, what work is unnecessary, what is more
difficult to maintain, or which instruction-file rule the line breaks.
