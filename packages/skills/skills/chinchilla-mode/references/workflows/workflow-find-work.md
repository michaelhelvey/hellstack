# Find Work

Run when I tell you to find busywork to do. Do the work in subagents, you are to act as a manager
agent.

Jira links:

- If you're doing something for transport4, create an operations task in JIRA first to link branches
  / pull requests to. Don't create a task for every pull request, create a single task for
  everything you do in a single run here. Just keep the task description updated with what you did.

Github:

- If you can't find a repository locally, just clone it. Use `~/dev/t4/*` for transport4 stuff, and
  `~/dev/helvetici/*` for personal stuff. Most stuff will probably already be cloned. Before working
  on something, make sure that you're on main and the latest changes from the remote are fetched.

Sources for work:

- Sentry. Use the sentry MCP to find open issues. Find the repository they point to on my local
  machine (usually `~/dev/{topic/username}/{repository-name}`), spin up a subagent there, have it
  triage the issue (is it a real problem, is it worth fixing, etc), and if it's worth fixing, make a
  fix and make a pull request.
- Pulse: Use chrome-devtools-mcp in codemode to go
  https://pulse.alpha.platform.transport4.com/code?window=30&workstream=null&owner=Michael+Helvey,
  and find the repositories that have outstanding alerts. Then spawn a subagent to fix them. Avoid
  adding to `overrides` in package manager when at all possible. Strongly prefer simply updating
  top-level packages where possible. Verify locally via all the relevant package manager audit
  commands that there are no outstanding vulnerabilities listed, then make a pull request.

Don't make up work. If nothing exists or is worth working on, that's fine. Just exit and say that.

When you're done, print a summary showing the jira task (if any) and github pull requests (if any)
that you created. I'll take it from there.
