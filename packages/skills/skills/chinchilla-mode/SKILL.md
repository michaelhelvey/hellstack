---
name: chinchilla-mode
description:
  How to build software.  Always apply this.  This is an "index" skill that branches out to many
  leaves across many topics.
---

# Chinchilla Mode

This is a collection of traits, behaviors, and rules that are important to me as you, an agent, work
collaboratively with me to build software.

## Traits

Load each trait as it is relative to what you are working on. For example, if you are writing
Typescript, load the `typescript` trait. When you use a trait, reference the trait that you applied
and why in your explanation of your work to the user. Traits may reference other traits or
workflows.

| Trait                            | Apply when                                                                                                                                                           | File                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Protect Your Time**            | Running shell commands or workflows (e.g. tests).                                                                                                                    | `./references/traits/trait-protect-your-time.md`       |
| **Build the lever**              | Encoding non-trivial rules, processes, and workflows as code, not as documents.                                                                                      | `./references/traits/trait-build-the-lever.md`         |
| **Prove it works**               | Proving that your changes work in the real world, rather than relying on checks you made up (e.g. tests).                                                            | `./references/traits/trait-prove-it-works.md`          |
| **Design from first principles** | Don't tack new functionality onto old interfaces that don't fit them. Design how it **should** work from first principles, then build that, refactoring when needed. | `./references/traits/trait-design-first-principles.md` |
| **Fix the root cause**           | Whenever you fix something. Fix the cause, not the symptom.                                                                                                          | `./references/traits/trait-fix-root-cause.md`          |
| **Complexity is a demon**        | Building a feature, fixing a bug, or creating a workflow. Proactively fight against adding complexity. Possibly the most important trait in this list.               | `./references/traits/trait-complexity-demon.md`        |
| **Typescript**                   | Writing Typescript. How to write great Typescript.                                                                                                                   | `./references/traits/trait-typescript.md`              |
| **Rust**                         | Writing Rust. How to write great Rust.                                                                                                                               | `./references/traits/trait-rust.md`                    |

## Workflows

Different kinds of tasks require different levels and kinds of work. Classify what the user is
asking you, and apply the playbook as you see fit.

| Workflow                       | Apply when                                                                          | File                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Fix a bug**                  | The user asks you to fix a bug.                                                     | `./references/workflows/workflow-bug.md`                  |
| **Collaborative design**       | The user asks to talk through something with them, design something with them, etc. | `./references/workflows/workflow-collaborative-design.md` |
| **Build autonomously**         | The user asks you to build a feature, a piece of software, etc.                     | `./references/workflows/workflow-build-autonomously.md`   |
| **Find what needs to be done** | Proactively search available channels for "busywork" that needs doing.              | `./references/workflows/workflow-find-work.md`            |
