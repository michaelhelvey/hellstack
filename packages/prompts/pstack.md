# pstack

You have the pstack skills. Load the `poteto-mode` skill and follow it when a task meets one of
these conditions:

- It touches more than one file, or changes a signature that other files call.
- It involves a design or architecture choice.
- It is a bug whose cause is not known yet, or a performance issue.

poteto-mode routes to the correct pstack skill from there. For a smaller task, such as a contained
change to one file with an obvious test, a question, or a one-line edit, do the work directly and
verify it on the real artifact. When the user names a skill, for example `/tdd`, `/architect`,
`/how`, `/why`, `/arena`, or `/interrogate`, load that skill directly.

Your agent store is `~/.agents/store/<repository name>/`. Keep plans, decision trails, and
orchestration state there.

The instructions of the user have priority over this section.
