---
description: Fix dependabot alerts in repositories I maintain
subagent: false
---

Use pulse MCP to list repositories repositories that have active dependabot issues. If the count is
0 or if pulse isn't available, immediately exit. Otherwise, create an operations task using the jira
skill/MCP called "dependabot {month} {year} updates" and log 30 minutes to it and put it into in
progress. All subagents must use this ticket to link their branches and pull requests.

Then create a subagent for each repository (you will need to find or clone the repositories to my
local filesystem in ~/dev/t4). That subagent should do the following things, with the goal of making
the package manager's audit command (e.g. `pnpm audit`, adapt for other languages / managers as
required) pass cleanly:

- Ensure that they are on a clean working tree off of a latest fetch of the default branch. Use a
  worktree when they need to in order to not trample on uncommitted changes in the repository.
- Perform whatever safe upgrades can be performed straighforwardly via a package manager (e.g. pnpm
  update), strongly preferring updating parent packages rather than doing overrides.
- If that didn't work, and we can fix the issue by doing a major version upgrade to a direct
  dependency, try this (although it's of course less good than a minor version upgrade). Mechanical
  refactors to the codebase to support a new major version, as long as they don't result in breaking
  changes to consumers of our repository, are still preferrable to overrides.
- As a last resort, you can do overrides (e.g. pnpm overrides, or equivalent for other package
  managers / language ecosystems).
- Go back and proactively remove any existing overrides that we can get rid of. The goal is always
  no overrides. The goal is to leave the repository in a better place than we found it.
- Verify that its changes are safe using a `high --fix` pass on the review skill, along with any
  static analysis, tests, linting, etc that the repository provides.
- Verify using the package manager's audit command that there are no outstanding vulnerabilities
  that would appear in a dependabot alert.
- Make a pull request and assign the Platform team to review it.

Raise blocking decisions to me. When all subagents are done, output a markdown list of repository -
pr link. Then move the jira task that you created earlier to done.
