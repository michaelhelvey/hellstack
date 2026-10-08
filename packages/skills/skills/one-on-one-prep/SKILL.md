---
name: one-on-one-prep
description:
  Prepares the user's 1:1 (one-on-one) meeting notes with their manager. Creates today's 1:1 doc in
  Rippling from the team template, collects the user's work from GitHub and JIRA since the last 1:1,
  and writes a short Wins/Progress list into the doc. Use when the user says "/one-on-one-prep",
  "prep my 1:1", or asks for a list of their recent work for a 1:1.
---

All paths below are relative to the directory of this skill.

## Config

Read the config file before you start. The file is `$ONE_ON_ONE_PREP_CONFIG`, or
`~/.config/one-on-one-prep/config.md` if that variable is not set. It has the private values that
must not be in this skill:

- The URL of the 1:1 page in Rippling.
- The name of the template to use.
- The GitHub orgs and the JIRA projects to search.
- The names for the doc header: the team member (the user) and the manager.
- Hints for the workstream labels (for example `[Core Services]`).

If the file does not exist, ask the user for these values. Then write the file in the same format
(one `##` section for each group, one `-` line for each value). Do not put these values in this
skill or in the repository.

## Browser

Use the browser tool that you have. Use one of these, in this order:

1. Claude in Chrome (`mcp__claude-in-chrome__*`). Load the `claude-in-chrome` skill first.
2. The `chrome-devtools-cli` skill, connected to the user's Chrome with `--autoConnect`.

The user must be signed in to Rippling in Chrome. Do not sign in for the user. If Rippling shows a
sign-in page, stop and ask the user to sign in.

Rippling uses a Lexical rich-text editor. Read [references/rippling.md](references/rippling.md)
before you read or change a doc. It has the page layout and the scripts to read and write the doc.

## Procedure

### 1. Find the date range

1. Open the 1:1 page from the config.
2. Read the list of meeting notes in the left panel. The newest note is at the top.
3. The start date is the date of the newest note that is before today. The end date is today.
4. Read the Wins/Progress section of that previous note (see
   [Read a doc](references/rippling.md#read)). Keep its items. You use them to remove work that the
   user already reported, and to use the same workstream labels.

If a note for today already exists, use it. Do not make a second note for the same day.

### 2. Collect the work (subagents)

Start two subagents in parallel, one for GitHub and one for JIRA. Give each subagent the date range
and the config values that it needs. If your harness has no subagents, do the two tasks yourself.

Each subagent returns a JSON array. Each item has this shape:

```json
{
  "source": "github | jira",
  "id": "<repo>#<number> or <ISSUE-KEY>",
  "url": "<full URL>",
  "title": "<title or summary>",
  "state": "merged | open | done | in progress | ...",
  "project": "<repo name or JIRA project key>",
  "parent": "<epic key and summary, JIRA only, or null>",
  "related": ["<ids of linked PRs or issues>"],
  "what": "<one sentence: what the user did and why it matters>"
}
```

**GitHub subagent prompt.** Find the pull requests of the GitHub user in these orgs between the two
dates. Use `gh`:

```bash
gh search prs --author @me --owner <org> --merged "<start>..<end>" --limit 200 \
  --json repository,number,title,url,state,closedAt,body
gh search prs --author @me --owner <org> --state open --updated ">=<start>" --limit 200 \
  --json repository,number,title,url,state,updatedAt,body
```

For a PR with an unclear title, read its body and its diff stat
(`gh pr view <url> --json body,additions,deletions,files`). Get the JIRA keys from the PR title,
branch, and body, and put them in `related`. Do not include PRs that were closed without a merge.

**JIRA subagent prompt.** Load the `jira` skill and run its setup. Find the issues that the user
worked on between the two dates. Search across projects with `scripts/api` and these JQL queries:

```
assignee = currentUser() AND updated >= "<start>" AND status NOT IN (Accounted, Removed)
worklogAuthor = currentUser() AND worklogDate >= "<start>" AND status NOT IN (Accounted, Removed)
```

Get `summary,status,issuetype,project,parent,issuelinks` for each issue. Read the description of an
issue only when the summary does not tell what the work was. Do not include a Sub-task as a separate
item. Use its parent. Do not include operations tasks for meetings, reviews, or other recurring
work.

### 3. Select the work

From the two lists, make a short list of the work that is important to a manager. Do these steps:

1. PRs often refer to JIRA issues that the JIRA search did not find (for example, issues that
   another person owns). Get the summary and status of these issues with the `jira` skill, and use
   them as the issue for those PRs. Make JIRA links as `<server>/browse/<KEY>`, with the server from
   the jira-cli config.
2. Join the items that are about the same work. For example, a JIRA story and the PRs that refer to
   it are one item. Use `related` and the titles.
3. Remove the work that the previous note already reported, unless the work changed (for example, a
   story that was in progress and is now done).
4. Remove items that are not important:
   - Automatic dependency updates, lint and format fixes, typos, and reverts.
   - Small chores with no effect on users or on the team.
   - Recurring operations tasks (meetings, standups, reviews of other PRs).
5. If there are many small items of the same type (for example, security fixes in many repos), join
   them into one item with all of their links.
6. Keep work that is in progress if it is important. Write it as progress, not as a finished result.

Aim for 5 to 12 items. Put the most important items first.

### 4. Write the items

Each item has:

- A workstream label in square brackets, in bold. Use the labels of the previous note and the hints
  in the config.
- One sentence that tells the result, not the activity. Use a past-tense verb and no period. For
  example: "Established the production foundation for projected-date calculations".
- One sub-item for each link (JIRA issue first, then PRs). Each sub-item is only the full URL.

Above the list, add one paragraph in italics: `Generated with the assistance of <model name>`. Use
the name of the model that you are.

Show the list to the user in chat before you change the doc. Change it if the user asks.

### 5. Make the doc

1. On the 1:1 page, make a new meeting note for today with the template from the config. See
   [Make a note](references/rippling.md#new-note).
2. Set the note date to today.
3. Fill in the header lines at the top of the doc:
   - "Team Member:" the team member name from the config.
   - "Manager:" the manager name from the config.
   - "Date:" today, as `MM/DD/YYYY`.

   Do not fill in "Core Value Shared:". If the config has no names, ask the user and add them to the
   config.

4. Put the list under the Wins/Progress heading. See [Write the list](references/rippling.md#write).
5. Read the doc again and make sure that the list is correct.

Do not change any part of the doc below the Wins/Progress list. The user fills in the other sections
(Ongoing Priorities, Annual Priorities, Challenges, Feedback, Action Items, and Misc Notes).

### 6. Report

Tell the user that the doc is ready. Show the list of items that you added, and the items that you
removed in step 3 with a short reason, so the user can add them back.
