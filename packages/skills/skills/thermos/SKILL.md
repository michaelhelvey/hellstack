---
name: thermos
description: "Launch both thermo-nuclear review subagents in parallel, then synthesize their findings. Use for thermos, double thermo review, or combined bug/security and code-quality branch audits."
disable-model-invocation: true
---

# Thermos

Run the two thermo review passes as subagents in parallel, then synthesize their results.

## Workflow

1. Determine the review scope from the user request, PR, current branch, or relevant changed files.
2. Gather the diff and any file/context excerpts needed for reviewers to evaluate the change without guessing.
3. Start both subagents at once. Each brief tells the subagent to read its agent file in full, by the absolute path of the file in this skill's `agents/` directory:
   - `agents/thermo-nuclear-review-subagent.md` for bugs, breakages, security, devex regressions, feature-flag leaks, and other branch-audit risks.
   - `agents/thermo-nuclear-code-quality-review-subagent.md` for maintainability, structure, file-size growth, spaghetti, abstractions, and codebase-health risks.
4. Pass each subagent the same scoped diff/file context, under the `### Git / diff output` and `### Changed file contents` headings, and ask it to return prioritized findings with file references and evidence.
5. After both finish, synthesize the results with findings first, deduplicated across reviewers. Weight overlapping findings more heavily, resolve disagreements with your own judgment, and keep summaries brief.

If individual subagent summaries are already visible to the user, do not restate them wholesale. Surface the unified verdict, the highest-signal findings, and any remaining uncertainty.
