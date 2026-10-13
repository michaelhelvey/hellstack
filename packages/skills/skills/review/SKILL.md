---
name: review
description:
  Reviews the current diff, a branch, a PR, or a file for bugs and cleanups, at an effort level from
  low to max. Can also apply the fixes. Use when the user says "/review", asks for a code review, or
  asks you to review their (or your) changes.
argument-hint: "[low|medium|high|xhigh|max] [--fix] [target or guidance...]"
disable-model-invocation: true
---

# Review

Review a diff for real bugs and cleanups. Do all of the work yourself, in this context. Do not start
subagents.

## Arguments

Usage: `/review [level] [--fix] [target or guidance...]`

The arguments are: `$ARGUMENTS`

If the line above is empty or shows a literal placeholder, read the arguments from the user message
that comes after this skill.

1. **Level.** If the first word starts with the first 3 letters of a level (`low`, `med`, `hig`,
   `xhi`, `max`), use that level. If you do not find a level, use `medium`. If the first word looks
   like a level but is not a valid level, ignore it, use `medium`, and tell the user in one short
   line. Valid levels: `low`, `medium`, `high`, `xhigh`, `max`.
2. **`--fix`.** The flag can be at any position. If it is present, apply the findings after the
   report (see [Apply fixes](#apply-fixes---fix)).
3. **Target or guidance.** All other words. A PR number, branch name, commit range, or file path is
   the review target. Other text is guidance from the user. Obey it when you find and rank findings.

Start the report with one short line that gives the level, for example `medium effort review`.

## Sub-Agents

If you have the ability to spawn a sub-agent, always run the review in a sub-agent. Do not run it
yourself.

## Phase 0 — Get the diff

Do this at all levels.

Run `git diff @{upstream}...HEAD` to get the diff. If there is no upstream, run
`git diff main...HEAD`, or `git diff HEAD~1` if there is no `main`. If there are uncommitted
changes, or the range diff is empty, also run `git diff HEAD` and include the working-tree changes.
The user often runs the review before the commit.

If the arguments give a target, review that target instead:

- PR number: `gh pr diff <number>` (GitHub) or `glab mr diff <number>` (GitLab).
- Branch: `git diff main...<branch>`.
- Commit range: `git diff <range>`.
- File path: the diff of that file. If the file has no changes, review the full file.

This diff is the review scope.

## Levels

| Level    | Procedure                                                 | Maximum findings | Target |
| -------- | --------------------------------------------------------- | ---------------- | ------ |
| `low`    | One pass of the diff only. No angles.                     | 8                | 4      |
| `medium` | 8 angles, up to 6 candidates each, dedup.                 | 8                | 4      |
| `high`   | 8 angles, up to 6 candidates each, dedup.                 | 10               | 5      |
| `xhigh`  | 10 angles, up to 8 candidates each, dedup, sweep.         | 15               | 7      |
| `max`    | 10 angles, up to 8 candidates each, verify, dedup, sweep. | 15               | 7      |

"Target" is the number of findings to try to find. If fewer real findings exist, report the ones
that you have. Do not make up findings to get to the target.

For `medium` and higher, read [references/angles.md](references/angles.md) before Phase 1.

### `low`

Read only the diff hunks. Do not read full files. Skip test and fixture hunks (`test/`, `tests/`,
`spec/`, `__tests__/`, `*_test.*`, `*.test.*`, `fixtures/`, `testdata/`).

Flag runtime correctness bugs that you can see from the hunk alone: an inverted or incorrect
condition, off-by-one, a null or undefined dereference where adjacent lines show that the value can
be absent, a removed guard, a falsy-zero check, a missing `await`, a copy-paste with the incorrect
variable, an error caught and not sent on when it must be. Also flag, from the hunk alone, new code
that duplicates a helper that you can see in the diff context, and dead code that the diff leaves.

Do **not** flag style, naming, performance, missing tests, or problems outside the diff. If you find
fewer than the target, examine the other hunks again, and the removed code blocks, before you stop.

Go to [Output](#output).

### `medium` and `high`

`medium`: you review for **correctness bugs**. Show each plausible bug. At this level, it is more
important to find real bugs than to prevent false positives.

`high`: you review for **recall**. Find each real bug that a careful reviewer finds in one session.
At this level, it is more important to find real bugs than to prevent false positives.

**Phase 1 — Find candidates.** Do the 8 angles in sequence: Angles A, B, and C, then Reuse,
Simplification, Efficiency, Altitude, and Conventions. Each angle gives **up to 6 candidates**, each
with `file`, `line`, a one-line `summary`, and a concrete `failure_scenario`. Keep each candidate
that has a failure scenario that you can name. Finders that silently drop candidates that they half
believe are the primary cause of missed bugs.

**Phase 2 — Dedup only.** Put all candidates together. Merge near-duplicates (same defect, same
location, same reason: keep one). Do not verify. Do not judge the candidates again. Sort by
severity.

Go to [Output](#output).

### `xhigh` and `max`

You review for **recall**. Find each real bug. At this level, it is more important to find real bugs
than to prevent false positives. A missed bug goes to production.

**Phase 1 — Find candidates.** Do all 10 angles in sequence: Angles A to E, then Reuse,
Simplification, Efficiency, Altitude, and Conventions. Each angle gives **up to 8 candidates**. Do
not let the result of one angle stop a candidate from a different angle. If two angles flag the same
line for different reasons, keep the two candidates.

**Phase 2 — Verify (`max` only).** Give each candidate exactly one verdict:

- **CONFIRMED**: you can name the inputs or state that cause it, and the incorrect output or crash.
  Quote the line.
- **PLAUSIBLE**: the mechanism is real, but the trigger is not certain (timing, environment,
  configuration). Say what would confirm it.
- **REFUTED**: the claim is incorrect (the code does not do that), or a different part of the code
  prevents it. Quote the line that shows this.

PLAUSIBLE is the default. Do not refute a candidate because it is "speculative" or "depends on
runtime state" when that state is realistic: concurrency races, null or undefined on a path that is
rare but possible (error handler, cold cache, missing optional field), falsy zero treated as
missing, off-by-one on a boundary that the code does not exclude, retry storms, partial failures, a
regex or allowlist that lost an anchor. Refute only when the code shows it: the claim is incorrect
(quote the line), it cannot occur (show the type, constant, or invariant), the diff already handles
it (quote the guard), or it is only style with no effect. Keep CONFIRMED and PLAUSIBLE. Drop
REFUTED.

**Phase 3 — Dedup.** Merge near-duplicates (same defect, same location, same reason: keep one). Sort
by severity. Do not drop a candidate because you are not sure of it.

**Phase 4 — Sweep for gaps.** Do one more pass as a new reviewer who has the list. Read the diff and
the enclosing functions again. Look ONLY for defects that are not on the list. Do not examine or
confirm the items on the list again. Look for the defects that the first pass usually misses:

- Moved or extracted code that lost a guard or an anchor.
- Second-level traps: a default value that is calculated one time (for example a Python dataclass
  default), non-deterministic `hash()`, a lock that now covers less code, predicate methods with
  side effects.
- Setup and teardown that do not match in tests.
- Configuration defaults that changed.

Add **up to 8 more candidates**. If you find nothing new, add nothing. Do not add filler.

Go to [Output](#output).

## Output

Correctness bugs always have a higher rank than Reuse, Simplification, Efficiency, Altitude, and
Conventions findings when the maximum causes you to remove findings.

For `low`, write one line for each finding, most severe first:

```
path/to/file.ext:123 — the problem and the concrete failure
```

If you find nothing, write `(none)`.

For all other levels, write a numbered list, most severe first. Use this format for each finding:

```
1. `path/to/file.ext:123`: one-sentence statement of the problem.
   Failure scenario: concrete inputs or state → incorrect output or crash.
```

If more findings than the maximum remain, keep the most severe. If no findings remain, write
`No findings.`

## Apply fixes (`--fix`)

Do this only when the arguments include `--fix`.

After the report, apply the findings to the working tree. Fix each one: correctness bugs, and reuse,
simplification, and efficiency cleanups. Do not fix a finding if the fix changes intended behavior,
needs changes far outside the reviewed diff, or if you think that the finding is a false positive.
Write that you skipped it. Do not argue with it.

Then run the lint, type check, and test commands of the project, if they exist. At the end, give a
short summary of the findings that you fixed and the findings that you skipped, with one line for
each skip that says why.
