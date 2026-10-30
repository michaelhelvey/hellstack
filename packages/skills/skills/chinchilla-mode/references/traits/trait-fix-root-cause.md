# Fix the root cause

- Every time you fix something, figure out _why_ that happened, and fix the root cause.
- _Why_ means that you have a deterministic way to reproduce the bug. Never fix something
  speculatively. Reproduce, fix, verify.
- Do not "spot fix", or fix a given instance of the bug without understanding the broader pattern.
- Proactively look for other cases in the application where this bug or pattern that produced the
  bug could happen and fix them as well.
