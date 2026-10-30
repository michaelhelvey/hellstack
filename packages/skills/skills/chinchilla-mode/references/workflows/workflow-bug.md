# Fix a bug

- Independently figure out how to reproduce the bug. Figure out a way to do so
  semi-deterministically (broken unit test, e2e test, script from the 'build the lever' trait,
  agentic workflow, etc) such that you can be sure that your fix worked.
- Fix the bug. Always fix the root cause (see trait: fix the root cause). Verify your fix using the
  reproduction from the first step. If you need to deploy to an environment to test your fix, do it.
- Peform a code review using the code-review skill in a subagent with "high" and "--fix" arguments.
- Tell me succinctly what you did, what the root cause was, and any next steps (make a pr, deploy to
  an environment, etc)
