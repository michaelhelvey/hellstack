---
name: reflect
description: Spawn three parallel review subagents over the active session, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

Invoke when the user says "reflect" or "/reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Locate the active session

Before fanning out, find this conversation's session in your session history (the pstack section says where). Read only this workspace's sessions. Reading across workspaces reads private chats from unrelated projects.

For each recent candidate, read its opening user message. Take the session whose opening message is this conversation's opening user prompt. If none matches, pass a tight digest of the session instead.

## 2. Spawn three reviewers in parallel

Start three subagents in parallel. Reviewers need MCP access to look up the tickets, chat threads, and observability traces the session references, so do not restrict their tools.

Each reviewer and the synthesizer name a role line of the pstack models sheet. Run each subagent on its line's model. Without the line, the subagent runs on the session model, and the panel is less diverse.

| Lens | Role line | Prompt template |
|---|---|---|
| Judgment | `reflect judgment, divergent, synthesizer` | `references/judgment-reviewer.md` |
| Tooling | `reflect tooling` | `references/tooling-reviewer.md` |
| Divergent | `reflect judgment, divergent, synthesizer` | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the session location or digest where marked. Reviewers return findings in their final reply.

## 3. Synthesize

Start one subagent on the model of the `reflect judgment, divergent, synthesizer` line. It spot-verifies citations through MCP, so do not restrict its tools. Pass `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. It returns an Accepted / Rejected / Backlog list.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. See the **encode-lessons-in-structure** principle skill.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

File each Backlog item to your team's devex or backlog tracker without waiting. Only the Accepted list waits for approval.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): follow the **Authoring or modifying a skill** playbook of poteto-mode ([authoring-a-skill.md](../poteto-mode/playbooks/authoring-a-skill.md)).
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): follow the same playbook to rewrite the description.
- `new skill: <kebab-name>`: follow the same playbook to create it. Do not invent the shape ad hoc.

Skills live under `packages/*/skills/` in a repo that ships skills, `.agents/skills/` in a project, or `~/.agents/skills/`.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
