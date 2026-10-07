---
name: jira
description:
  Works with JIRA and Confluence on Atlassian Cloud. Searches, reads, creates, updates, and moves
  issues, logs time, creates operations (ops) tasks, manages weekly KPIs, and reads Confluence
  pages. Use when the user asks about JIRA tickets, tasks, epics, sprints, boards, time tracking,
  ops tasks, weekly or individual KPIs, quarterly rocks, or Confluence pages, specs, PRDs, and wiki
  links (<site>.atlassian.net/wiki/...).
---

All paths below are relative to the directory of this skill.

## Setup

Run `scripts/setup` one time per session before your first JIRA or Confluence call. It is fast and
does not change a config that works.

```bash
scripts/setup
```

The script:

1. Installs [jira-cli](https://github.com/ankitpokhrel/jira-cli) with Homebrew or `go install` if it
   is not installed.
2. Gets the API token from `JIRA_API_TOKEN` or `JIRA_API_KEY`, and the email from `JIRA_USER_EMAIL`
   or `git config user.email`.
3. Finds the Atlassian site. It tries `--server`, then `JIRA_BASE_URL`, then the jira-cli config,
   then `https://<email domain>.atlassian.net`. It uses the first site that accepts the credentials.
4. Writes the jira-cli config to `~/.config/.jira/.config.yml` (or `JIRA_CONFIG_FILE`). The config
   does not contain the token.

If the script fails:

- **No token:** stop. Tell the user to set `JIRA_API_TOKEN` or `JIRA_API_KEY`.
- **No site found:** ask the user for the site URL. Then run
  `scripts/setup --server https://<site>.atlassian.net`.

The site URL is in the `server` line of the jira-cli config. Use it when you give links to the user:
`<server>/browse/<ISSUE-KEY>`.

<a id="memory"></a>

## Memory

The memory file keeps facts that the user tells you, for example the boards and projects that they
use. The file is `$JIRA_MEMORY_FILE`, or `~/.config/jira/memory.md` if that variable is not set.

Read the memory file before your first JIRA call in a session. It is short. If it does not exist,
continue without it.

Use the memory to find the scope of a request. For example, "what do I have this sprint" means the
active sprint on the boards in the memory file. If there are no boards in the memory file, search
across all projects (see [Search](#search)) and ask the user if they want to save a board.

### Save to memory

When the user tells you to remember something (for example, "I am on a new project, here is its
board"), write it to the memory file. Create the file and its directory if they do not exist.

For a board URL such as `<server>/jira/software/c/projects/<KEY>/boards/<ID>/...`, get the board
data before you save it:

```bash
scripts/api /rest/agile/1.0/board/<ID> | jq '{id, name, type, project: .location.projectKey}'
```

Use this format, and keep one line for each board:

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

### Board recipes

```bash
# The active sprint of a scrum board
scripts/api /rest/agile/1.0/board/<ID>/sprint -G --data-urlencode state=active \
  | jq -r '.values[] | [.id, .name, .startDate, .endDate] | @tsv'

# My issues in the active sprint of a board
scripts/api /rest/agile/1.0/board/<ID>/issue -G \
  --data-urlencode 'jql=sprint in openSprints() AND assignee = currentUser() AND status NOT IN (Accounted, Removed)' \
  --data-urlencode 'fields=summary,status,issuetype,priority' --data-urlencode maxResults=100 \
  | jq -r '.issues[] | [.key, .fields.issuetype.name, .fields.status.name, .fields.summary] | @tsv'
```

Remove `assignee = currentUser()` for all issues in the sprint. For the backlog, use
`/rest/agile/1.0/board/<ID>/backlog`. A kanban board has no sprints. Use `/board/<ID>/issue` with
`statusCategory != Done`.

## Tools

| Tool                            | Use for                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| `scripts/jira-cli <args>`       | Work in one project: list, view, edit, move, and log time on issues. |
| `scripts/api <path> [curl ...]` | Searches across projects, field lookup, creates with a parent, wiki. |
| `scripts/issue <KEY>`           | Read one issue with its description and Acceptance Criteria as text. |
| `scripts/ops-epics`             | Find the current operations epics. See [Operations tasks](#ops).     |
| `scripts/worklog.py`            | "What did I log time to today, yesterday, or on \<date\>?"           |
| `scripts/kpi.ts`                | Create, list, and update weekly KPIs. See [Weekly KPIs](#kpi).       |
| `scripts/render-confluence.py`  | Change a Confluence page to Markdown. See [Confluence](#confluence). |

Always use `scripts/jira-cli`, not `jira`. The wrapper gives the token to jira-cli.

`scripts/api` adds the site and the credentials to the request. Give it the path only. On an HTTP
error it prints the response body and exits with code 22. Show the status and the error message to
the user.

`scripts/worklog.py` prints a table of all issues that the user logged time to on one day. Use
`--date YYYY-MM-DD` or `--yesterday`. Use `--json` when you must calculate with the numbers. The
table does not show Accounted or Removed tasks (see [Statuses](#statuses)).

## jira-cli

Use `--plain` for tables and `--raw` for JSON. Use `--no-input` on `create` and `edit`, because
prompts stop the command.

```bash
scripts/jira-cli issue list -p <PROJECT> -q 'assignee = currentUser() AND statusCategory != Done' \
  --plain --columns key,type,status,summary
scripts/jira-cli issue view <KEY> --plain --comments 5
scripts/jira-cli issue create -p <PROJECT> -t Sub-task -P <PARENT-KEY> -s "<summary>" -e 10h --no-input
scripts/jira-cli issue edit <KEY> -s "<summary>" --no-input
scripts/jira-cli issue edit <KEY> -P <EPIC-KEY> --no-input
scripts/jira-cli issue move <KEY> "In Progress"
scripts/jira-cli issue worklog add <KEY> "1h 30m" --timezone <timezone> --comment "<text>" --no-input
```

Known problems:

- **`-q` is always limited to one project.** jira-cli adds `project="<KEY>" AND` before your JQL.
  For a search across projects, use `scripts/api` (see [Search](#search)).
- **Do not use `issue create -P` for an issue that is not a Sub-task.** In company-managed projects,
  jira-cli sends the old "Epic Link" field, and JIRA refuses it. Use `scripts/api` (see
  [Create an issue under an epic](#create-under-epic)). `issue edit -P` is correct.
- **`issue view --plain` does not show custom fields.** Use `scripts/issue` for the Acceptance
  Criteria.
- **`worklog add` uses UTC if you do not give `--timezone`.** Use the `timezone` value from the
  jira-cli config.
- **jira-cli has no Confluence commands.** Use `scripts/api`.

## Fields

Do not write field IDs such as `customfield_12345` into scripts or notes. The IDs are different on
each site. Find the ID from the field name:

```bash
scripts/api /rest/api/3/field | jq -r '.[] | select(.name | test("<name>"; "i")) | "\(.id)\t\(.name)"'
```

In JQL, you can use the field name in quotes, for example `"Business Category" = Operations`.

## Read an issue

When you read an issue to understand the work (for example, the requirements of a story), always
read the description **and** the Acceptance Criteria. Many stories have important details only in
the Acceptance Criteria.

```bash
scripts/issue <KEY>
```

<a id="search"></a>

## Search across projects

Use `/rest/api/3/search/jql`. Do not use `/rest/api/3/search`, because it is deprecated.

```bash
scripts/api /rest/api/3/search/jql -G \
  --data-urlencode 'jql=assignee = currentUser() AND statusCategory != Done' \
  --data-urlencode 'fields=summary,status,issuetype,project,parent' \
  --data-urlencode maxResults=100 \
  | jq -r '.issues[] | [.key, .fields.issuetype.name, .fields.status.name, .fields.summary] | @tsv'
```

Boards come from `/rest/agile/1.0/board`. Each board has `.location.projectKey`. A project can have
more than one board. Sprints are on scrum boards: `/rest/agile/1.0/board/<id>/sprint`.

<a id="create-under-epic"></a>

## Create an issue under an epic

```bash
scripts/api /rest/api/3/issue -X POST -d '{
  "fields": {
    "project": {"key": "<PROJECT>"},
    "issuetype": {"name": "Task"},
    "parent": {"key": "<EPIC-KEY>"},
    "summary": "<summary>",
    "timetracking": {"originalEstimate": "10h"}
  }
}' | jq -r .key
```

The parent can be in a different project.

## Time tracking and sub-tasks

We must track time on our work.

- A story (or a similar type, for example a Bug) must have a Sub-task. The Sub-task has the same
  summary as its parent. Log time on the Sub-task, not on the parent.
- Put an original estimate of `10h` on each issue that you create, unless the user gives a different
  value. Do not estimate time yourself. We do not use the estimate, but JIRA does not let an issue
  go to In Progress without it.

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

The current ops epic changes over time. Find it each time. Do not remember it from an earlier
session, and do not guess it from a name.

```bash
scripts/ops-epics
```

The script finds open epics with `"Business Category" = Operations`. It shows the most relevant
epics first:

- `my_ops_issues_30d` is the number of issues under the epic that the user logged time to in the
  last 30 days.
- `my_project_issues_60d` is the number of issues in the project that the user worked on in the last
  60 days.
- `boards` is the names of the boards in the project.

### Create an ops task

1. Run `scripts/ops-epics`.
2. Ask the user which ops epic to use, unless they already told you the team, board, or epic. Show
   each choice as board name, epic key, and epic summary. Recommend the first epic. If a summary
   names a past month or quarter, tell the user that the epic can be old.
3. Create a Task in the project of that epic, with the epic as parent (see
   [Create an issue under an epic](#create-under-epic)).
4. Give the user the new key and the link.

<a id="kpi"></a>

## Weekly KPIs

Each person has individual (leading) KPIs for the quarter. A KPI is a Task under a quarterly rock
(an Epic). It has one Sub-task for each week ("Week 1" to "Week 13"), and each week has a due date.
A week has the status "No" until the person sets it to "Yes" (the KPI target for that week was
achieved). The workflow cannot move a week from "Yes" back to "No".

All KPIs are copies of a template issue. `scripts/kpi.ts` finds the template from
`JIRA_KPI_TEMPLATE` (an issue key), or else searches for an open issue with
`JIRA_KPI_TEMPLATE_SUMMARY` in its summary (default: "Template Individual KPI"). The project and the
rocks come from the template.

```bash
scripts/kpi.ts info                    # the template, its project, and the due date of each week
scripts/kpi.ts rocks                   # open quarterly rocks, with their initiatives
scripts/kpi.ts list [--all]            # my KPIs and the result of each week
scripts/kpi.ts create --rock <EPIC-KEY> --summary "<KPI text>" [--dry-run]
scripts/kpi.ts update <KPI-KEY> --yes [--week <n|current|previous>] [--comment "<notes>"]
```

- `create` copies the template and its weeks, assigns all of them to the user, sets the rock as
  parent, and moves the KPI to In Progress. It does not add a "clones" link.
- `list` shows `weeks` as one character for each week: `Y` (Yes), `N` (past week, No), and `.` (not
  due yet). `this_week` is the week that is due next.
- `update` changes the current week by default: the first week with a due date on or after today. If
  the user tells you about last week (for example, on a Monday), use `--week previous`.

### Create a KPI

1. Run `scripts/kpi.ts rocks`. Ask the user which rock the KPI supports, unless they told you. Show
   the rock key, the initiative, and the summary.
2. Get the KPI text from the user. Do not write it yourself.
3. Run `create` with `--dry-run`, and show the plan to the user. Run it without `--dry-run` after
   the user agrees.
4. Give the user the new key and the link.

### Update a KPI

Ask the user for the result of each KPI (Yes or No) and for notes, unless they told you. Do not
guess a result from other work. Setting "Yes" cannot be undone, so confirm the KPI and the week
before you run `update --yes`. `--no` only adds the comment, because a week is "No" until it
changes.

## Fields that you must not change

Project managers set these fields manually. Do not set or change them, also when you create an
issue:

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

1. Do not show Accounted or Removed issues to the user. Add `AND status NOT IN (Accounted, Removed)`
   to JQL.
2. Do not move an issue to Accounted.
3. When the user asks about "my tasks" or "current tasks", show only issues that are not in the Done
   category.

<a id="confluence"></a>

## Confluence

Confluence is on the same site and uses the same credentials. Use `scripts/api` for Confluence
pages. Do not use a web fetch tool, because the pages need authentication.

### Read a page

```bash
scripts/render-confluence.py <PAGE-ID or page URL> > "<scratch-dir>/page.md"
```

The script prints the page as Markdown:

- **Tables** stay Markdown tables. A cell with more than one line uses `<br>` between the lines.
  Specs often put the important requirements in tables, and the column headers give the cells their
  meaning. Do not change tables to prose. A row such as `| Destination | CO and CP | CP |` has a
  different meaning when you remove the direction column.
- **Mermaid diagrams** become ` ```mermaid ` code blocks. The "mermaid-cloud" macro keeps the
  diagram source in a page attachment, and the script downloads it. If the script cannot find the
  source, it prints `[Mermaid diagram '<name>': no source found]`.
- **Links to other pages** become `[[Page Title]]`. Use the title in a CQL `title = "..."` search to
  find the page ID.
- **Mentions** become `@Display Name`. **Status labels** become `[Label]`. **Panels** (info, note,
  warning) become block quotes. **Tasks** become `- [ ]` and `- [x]` items.
- **Other macros** without text become `[<name> macro]`.

Pages are often long. Save them to a scratch file and use `grep -n` to find the terms that you need.
Do not put the full page into your context.

### Search

Use CQL (Confluence Query Language) with the v1 search endpoint:

```bash
scripts/api /wiki/rest/api/search -G \
  --data-urlencode 'cql=text ~ "<words>" and type = page' --data-urlencode limit=25 \
  | jq -r '.results[] | [.content.id, .content.type, .title] | @tsv'
```

Useful CQL clauses: `text ~ "..."`, `title ~ "..."`, `space = "..."`, `type = page`,
`parent = <ID>`, `lastModified >= "2026-01-01"`.

Always show `.content.type` with the ID. Search gives pages, folders, databases, attachments, and
comments together. `/wiki/api/v2/pages/<id>` gives `404 NOT_FOUND` for all types that are not
`page`. This looks like a permissions problem, but it is not.

### Walk a folder

Specs are often in a Confluence folder. A folder has no body. Use CQL `parent = <FOLDER-ID>` to list
its children. Do not use the v2 `/pages?parent-id=<id>` parameter. The API ignores it and gives all
pages on the site.

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
