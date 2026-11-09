---
name: jira
description:
  Works with JIRA and Confluence on Atlassian Cloud. Searches, reads, creates, updates, and moves
  issues, logs time, creates operations (ops) tasks, manages weekly KPIs, and reads Confluence
  pages. Use when the user asks about JIRA tickets, tasks, epics, sprints, boards, time tracking,
  ops tasks, weekly or individual KPIs, quarterly rocks, or Confluence pages, specs, PRDs, and wiki
  links (<site>.atlassian.net/wiki/...).
disable-model-invocation: true
---

## Tools

The JIRA and Confluence tools are in the `jira` namespace. They are deferred: they are not in your
tool list, and you call them only from `codemode` scripts. Before your first call in a session, get
their declarations:

```js
const ns = await describeNamespace("jira");
return ns;
```

Then call them as `tools.<name>(args)`. Each tool resolves to a structured object, so filter and
join the results in the script, and return only what you need:

```js
const { issues } = await tools.jira_search({
  jql: "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC",
});
return issues.map((i) => `${i.key}\t${i.status}\t${i.summary}`).join("\n");
```

| Tool                                               | Use for                                                     |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `jira_whoami`                                      | The site and the account that the tools use.                |
| `jira_search`                                      | JQL searches across all projects.                           |
| `jira_issue`                                       | Read one issue: description, Acceptance Criteria, comments. |
| `jira_create_issue`, `jira_update_issue`           | Create and edit issues.                                     |
| `jira_transition`, `jira_comment`                  | Move an issue to a status. Add a comment.                   |
| `jira_log_work`, `jira_worklog_day`                | Log time. "What did I log time to on \<day\>?"              |
| `jira_fields`                                      | Find the ID of a field from its name.                       |
| `jira_boards`, `jira_sprints`, `jira_board_issues` | Boards, sprints, and the issues of a board.                 |
| `jira_ops_epics`                                   | Find the current operations epics. See [Ops tasks](#ops).   |
| `jira_kpi_*`                                       | Weekly KPIs. See [Weekly KPIs](#kpi).                       |
| `confluence_search`, `confluence_children`         | Find Confluence pages. See [Confluence](#confluence).       |
| `confluence_page`                                  | Read a Confluence page as Markdown.                         |
| `jira_request`                                     | A REST API call that no other tool does.                    |

Use `jira_request` only when no other tool does the job, for example to delete a worklog or to add
an issue link. Its path is relative to the site. On an HTTP error, show the status and the error
message to the user.

### Credentials

The tools read the credentials on the first call:

- The token comes from `JIRA_API_TOKEN` or `JIRA_API_KEY`.
- The email comes from `JIRA_USER_EMAIL`, or from `git config --global user.email`.
- The site comes from `JIRA_BASE_URL`, or else the tools try `https://<email domain>.atlassian.net`.

If a tool says that there is no token, stop and tell the user to set `JIRA_API_TOKEN`. If a tool
says that the site does not accept the credentials, ask the user for the site URL, and tell them to
set `JIRA_BASE_URL` and restart pi.

If `describeNamespace("jira")` gives `undefined`, codemode cannot reach the tools. Tell the user to
add `"defaultTools": ["+codemode"]` to the pi settings.

<a id="memory"></a>

## Memory

The memory file keeps facts that the user tells you, for example the boards and projects that they
use. The file is `$JIRA_MEMORY_FILE`, or `~/.config/jira/memory.md` if that variable is not set.

Read the memory file before your first JIRA call in a session. It is short. If it does not exist,
continue without it.

Use the memory to find the scope of a request. For example, "what do I have this sprint" means the
active sprint on the boards in the memory file. If there are no boards in the memory file, search
across all projects with `jira_search`, and ask the user if they want to save a board.

### Save to memory

When the user tells you to remember something (for example, "I am on a new project, here is its
board"), write it to the memory file. Create the file and its directory if they do not exist.

For a board URL such as `<server>/jira/software/c/projects/<KEY>/boards/<ID>/...`, get the board
data with `jira_boards({ id: <ID> })` before you save it. Use this format, and keep one line for
each board:

```markdown
## Boards

- Platform Scrum Board: id 905, scrum, project PT. My team board.

## Notes

- <other facts the user told you>
```

Rules:

- Save only facts that stay correct for a long time: boards, projects, teams, and the user's role on
  them. Do not save sprints, ops epics, or issue status. These change, so find them each time.
- When the user leaves a project or a board, remove its line. Do not keep old entries.
- Tell the user what you changed in the file.

### Boards and sprints

- `jira_sprints({ board })` gives the active sprint of a scrum board.
- `jira_board_issues({ board, scope: "sprint", mine: true })` gives the user's issues in the open
  sprints. Remove `mine` for all issues in the sprint.
- `scope: "backlog"` gives the backlog. A kanban board has no sprints: use `scope: "open"`.

## Fields

Field IDs such as `customfield_12345` are different on each site. Do not write them into notes. Find
a field with `jira_fields({ name })`. `jira_create_issue` and `jira_update_issue` accept field names
in `fields`, for example `{ "Story Points": 3 }`. In JQL, use the field name in quotes, for example
`"Business Category" = Operations`.

## Read an issue

When you read an issue to understand the work (for example, the requirements of a story), always
read the description **and** the Acceptance Criteria. Many stories have important details only in
the Acceptance Criteria. `jira_issue` gives both as Markdown.

## Search

`jira_search` takes JQL and searches across all projects. Boards come from `jira_boards`. A project
can have more than one board.

## Create an issue

`jira_create_issue` sets the `parent` field, so the parent can be an epic in any project. Give the
user the `url` of each issue that you create or change.

## Time tracking and sub-tasks

We must track time on our work.

- A story (or a similar type, for example a Bug) must have a Sub-task. The Sub-task has the same
  summary as its parent. Log time on the Sub-task, not on the parent. Use `withSubtask: true` when
  you create a story or a bug.
- The original estimate of each new issue is `10h`, unless the user gives a different value. Do not
  estimate time yourself. We do not use the estimate, but JIRA does not let an issue go to In
  Progress without it.
- `jira_log_work` uses the time zone of the JIRA account for times without an offset.
- `jira_worklog_day` does not list Accounted or Removed tasks (see [Statuses](#statuses)). It gives
  their count and time in `hidden`, and the total includes them.

<a id="ops"></a>

## Operations tasks

Operations (ops) tasks track time on work that is not part of a user story. Examples are meetings,
goals, reviews, and support.

### Structure

- Each team project has an operations epic. Many teams make a new ops epic each month or each
  quarter, and close the old one.
- Ops tasks go directly under the ops epic. Their type is usually Task, but can be Sub-task. There
  is no Sub-task below an ops task.
- Log time directly on the ops task.

### Find the ops epic

The current ops epic changes over time. Find it each time with `jira_ops_epics`. Do not remember it
from an earlier session, and do not guess it from a name.

The tool gives open epics with `"Business Category" = Operations`, the most relevant first:

- `myOpsIssues30d` is the number of issues under the epic that the user logged time to in the last
  30 days.
- `myProjectIssues60d` is the number of issues in the project that the user worked on in the last 60
  days.
- `boards` is the names of the boards in the project.

### Create an ops task

1. Run `jira_ops_epics`.
2. Ask the user which ops epic to use, unless they already told you the team, board, or epic (also
   in the memory file). Show each choice as board name, epic key, and epic summary. Recommend the
   first epic. If a summary names a past month or quarter, tell the user that the epic can be old.
3. Create a Task in the project of that epic, with the epic as `parent`.
4. Give the user the new key and the link.

<a id="kpi"></a>

## Weekly KPIs

Each person has individual (leading) KPIs for the quarter. A quarterly rock has a KPI epic for each
team, and a KPI is a Task under a KPI epic. A KPI has one Sub-task for each week ("Week 1 - <KPI>"
to "Week 13 - <KPI>"), and each week has a due date (a Friday).

A week starts as "Open". The transition "KPI Completed" moves it to "Yes" (the KPI target for that
week was achieved), and "Did not do" moves it to "No". "Yes" and "No" are both in the Done category,
so read the status name, not the category.

The tools find KPIs from the "Week 1" sub-tasks that are assigned to the user, so listing and
updating KPIs does not need a template. New KPIs copy the project and the issue types from the KPI
template (`JIRA_KPI_TEMPLATE`, an issue key, or an open issue with `JIRA_KPI_TEMPLATE_SUMMARY` in
its summary, default "Template Individual KPI"). If there is no template, they copy them from the
newest KPI of the user, and `jira_kpi_info` tells you why in `note`.

| Tool              | Gives or does                                                            |
| ----------------- | ------------------------------------------------------------------------ |
| `jira_kpi_info`   | The source of new KPIs, its project, and the weeks of a new KPI.         |
| `jira_kpi_rocks`  | The open KPI epics (the parents of KPIs), with their quarterly rocks.    |
| `jira_kpi_list`   | The user's KPIs and the result of each week.                             |
| `jira_kpi_create` | Makes a KPI and its weeks under a KPI epic. `dryRun: true` gives a plan. |
| `jira_kpi_update` | Sets the result of one week (default: the current week), with notes.     |

- `jira_kpi_create` assigns the KPI and its weeks to the user, and moves the KPI to In Progress. The
  due dates come from the template, or else they are weekly from the first Friday of the quarter.
  `firstDue` sets the due date of week 1.
- In `jira_kpi_list`, `grid` has one character for each week: `Y` (Yes), `N` (No), `!` (a past week
  without a result), and `.` (not due yet). `missing` lists the past weeks without a result.
  `thisWeek` is the week that is due next.
- The current week is the first week with a due date on or after today. If the user tells you about
  last week (for example, on a Monday), use `week: "previous"`.

### Create a KPI

1. Run `jira_kpi_rocks`. Ask the user which KPI epic the KPI goes under, unless they told you. Show
   the key, the summary, and the quarterly rock (`initiative`).
2. Get the KPI text from the user. Do not write it yourself.
3. Run `jira_kpi_create` with `dryRun: true`, and show the plan to the user, with the due dates. Run
   it without `dryRun` after the user agrees.
4. Give the user the new key and the link.

### Update a KPI

Run `jira_kpi_list` first. Tell the user about the weeks in `missing`.

Ask the user for the result of each week (Yes or No) and for notes, unless they told you. Do not
guess a result from other work. Confirm the KPI, the week, and the result with the user before you
run `jira_kpi_update`. The tool does not change a week that already has the other result. To fix a
wrong result, move the week back to "Open" with `jira_transition` after the user agrees, and then
set it again.

## Fields that you must not change

Project managers set these fields manually. Do not set or change them, also when you create an
issue. The tools refuse them:

- Business Category
- Operations Category
- Complete Work Sprint
- All CWIP fields, for example "Epic Link CWIP" and "CWIP Eligible"

<a id="statuses"></a>

## Statuses

Each status has a category: To Do (`new`), In Progress (`indeterminate`), or Done (`done`). Use
`statusCategory` in JQL when you can. Status names are different for each issue type. Examples are
Backlog, New, To Do, In Progress, Ready for Release, Done, Removed, and Accounted.

- **Accounted** is a final status. It means that an internal audit system has the task, and that the
  task is frozen. Only project managers set it.
- **Removed** is a final status for work that the team will not do.

Rules:

1. Do not show Accounted or Removed issues to the user. `jira_search` and `jira_board_issues` leave
   them out, and give the number that they left out. Do not use `includeHidden` unless the user asks
   for these issues.
2. Do not move an issue to Accounted. `jira_transition` refuses it.
3. When the user asks about "my tasks" or "current tasks", show only issues that are not in the Done
   category.

<a id="confluence"></a>

## Confluence

Confluence is on the same site and uses the same credentials. Use the Confluence tools for pages. Do
not use a web fetch tool, because the pages need authentication.

### Read a page

`confluence_page({ page })` takes a page ID or a page URL, and gives the page as Markdown:

- **Tables** stay Markdown tables. A cell with more than one line uses `<br>` between the lines.
  Specs often put the important requirements in tables, and the column headers give the cells their
  meaning. Do not change tables to prose. A row such as `| Destination | CO and CP | CP |` has a
  different meaning when you remove the direction column.
- **Mermaid diagrams** become ` ```mermaid ` code blocks. The "mermaid-cloud" macro keeps the
  diagram source in a page attachment, and the tool downloads it. If the tool cannot find the
  source, it gives `[Mermaid diagram '<name>': no source found]`.
- **Links to other pages** become `[[Page Title]]`. Use the title in a CQL `title = "..."` search to
  find the page ID.
- **Mentions** become `@Display Name`. **Status labels** become `[Label]`. **Panels** (info, note,
  warning) become block quotes. **Tasks** become `[ ]` and `[x]` items.
- **Other macros** without text become `[<name> macro]`.

Pages are often long. Do not put the full page into your context. In the script, keep only the
sections that you need, or write the page to a scratch file with `tools.write` and then use `grep`
to find the terms that you need.

### Search

`confluence_search({ cql })` uses CQL (Confluence Query Language). Useful clauses: `text ~ "..."`,
`title ~ "..."`, `space = "..."`, `type = page`, `parent = <ID>`, `lastModified >= "2026-01-01"`.

Always look at the `type` of each result. Search gives pages, folders, databases, attachments, and
comments together. Only a `page` has a body that `confluence_page` can read. For other types, the
API gives `404 NOT_FOUND`. This looks like a permissions problem, but it is not.

### Walk a folder

Specs are often in a Confluence folder. A folder has no body. Use `confluence_children({ id })` to
list its children.

### Trace a requirement to its source

Requirements go down this chain: **customer questionnaire → discovery brief → product PRD →
engineering PRD → JIRA epic or feature → repository docs → config**. Each step copies the text, so
an error at the top goes all the way into the production config.

When a value looks wrong, do not stop at the first document that has it. Go up the chain to the
source that the customer confirmed. This is usually a questionnaire page with a "Comments from
\<customer contact\>" column. Also compare the acceptance criteria of the PRD with its summary and
config tables. When they are different, the acceptance criteria are usually closer to the source.

## Output

- Show issues with key, summary, status, assignee, and priority.
- Show a list of issues as a short table.
- Give a link to each issue that you create or change.
