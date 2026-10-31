---
name: workflow-fix-bug
description: Apply when the user asks you to fix a bug
disable-model-invocation: true
---

# Workflow: Bug Fix

- Independently figure out how to reproduce the bug in a semi-deterministic way (broken unit test,
  e2e test, script from trait: build the lever, etc), such that you can re-run it when you are done
  to verify that your fix worked.
- Apply trait: fix the root cause. Don't just fix the symptom.
- Apply trait: prove it works.
- Code review step: run `/review high --fix` on your changes.
- Tell me succinctly 1) how did you reproduce it 2) what was the root cause 3) how did you fix it 4)
  how can I see the fix 5) any next steps (make a pr, deploy to an environment, etc).
