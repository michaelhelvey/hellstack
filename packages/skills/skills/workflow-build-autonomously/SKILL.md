---
name: workflow-build-autonomously
description:
  Apply when I ask to you to build a piece of software, a feature, or some other non-trivial work on
  your own, without my direct oversight.
disable-model-invocation: true
---

# Workflow: Build Autonomously

Your task is to autonomously build the feature or piece of software that I specify below.

## Task Definition

Every good task contains the following information:

1. What are you building? (e.g. is there a design markdown file that we should be referencing, what
   did I ask for in my prompt, etc)
2. How will you verify that you are done and it works? Traits: build the lever, prove it works.
3. What do I want to see as output? (e.g. what do I want you to deliver at the end -- a printed
   explanation, a demo, an image, a dashboard, etc?)
4. What constraints do we have (think: hardware constraints, dependency constraints e.g. what
   libraries to use, infrastructure contraints e.g. use Lambda not ECS, etc)

I don't have to give you all of this explicitly, but if any of it is unclear to you or you can't
assume a reasonable default, stop and figure it out with me.

## Goal Alignment

Before writing any code, or designing anything, restate in your own words your understanding of the
above. Keep it short and straightforward -- a couple of sentences per item, maximum. Get my sign off
before continuing.

Confirm with me if it's not clear 1) whether you should create a PR with your work or leave it local
and 2) what JIRA ticket is associated with this work (if you need to make a PR, and I'm at work;
Personal work doesn't require jira tickets).

## Working tree

Confirm with me where the work should land. Usually for me this is a local checkout that is tied to
a jira ticket (if I'm at work). For example, I might be on branch ab-123-some-feature when I ask you
to start this workflow. Your job will be to manage agents in worktrees and ultimately bring
everything back so that at the end state there are no extra branches or worktrees hanging around,
and all work is (at least) locally committed on the checkout. Worktrees are for you, not for me. I
don't want to have to think about them or have them be left around on my machine.

Always start from a clean checkout of the branch that the work should land on, and confirm with me
what to do if the current working tree is not clean.

## Workflow

You should act as a chief of staff, a lead engineer for the project. Your task is to guide,
parallelize, and manage the work of other subagents, and be the primary point of contact for me on
the project. You should not ever write code yourself directly.

How exactly you break down work is up to you. Different things will have different levels that are
appropriate to them, use your best judgement in how you split up work. For some work, it may be
appropriate to spin up one or more design or architecture agents to more fully understand a domain
before you implement code. Other times, it's too much, and you can spin up implementation subagents
immediately.

When you create a subagent to perform some clearly defined unit of work, when they are done, always
run `/review high --fix` on their output before merging it back into your branch. Proactively merge
worktrees from subagents into the main checkout as quickly as reasonable to avoid merge conflicts.

While you are managing this workflow, assume that I am not available. Raise issues to me at the end
if you need my input on something rather than blocking your work.

After all implementation is complete, perform a final review pass focused on consistency and
correctness across the various parts that you've been stitching together. It's easy for little
changes to be fine on their own but to ultimately end up looking like a beautiful statue where the
arms are sticking out of the ears. That's bad. Think "deep modules" by Ousterhout for how things
should fit together. No leaky abstractions.

## When Are You Done

You are done when you are 100% confident in the quality, correctness, performance, and security of
the final software, in alignment with all of our [traits](../chinchilla-mode/SKILL.md), and when all
work is merged and committed locally (or a pull request is made and CI/CD is green, if we went with
that flow), and when all worktrees or other temporary artifacts that you created on my disk are
cleaned up.

## Output

When you are done, I want you to summarize the following things for me. Keep each point short and
straightforward.

1. What did you do?
2. How can I demo it for myself? Be specific: run this shell command, go to this specific URL, click
   this button, etc.
3. What do you need from me? Any blocking decisions, concerns, or pressing things that I need to
   know about.
