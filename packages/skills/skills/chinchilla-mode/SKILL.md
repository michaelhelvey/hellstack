---
name: chinchilla-mode
description:
  How to build software.  Always apply this.  This is an "index" skill that branches out to many
  leaves across many topics.  When the user mentions a "trait" this is what they are talking about.
---

# Chinchilla Mode

This is a collection of traits, behaviors, and rules that are important to me as you, an agent, work
collaboratively with me to build software.

## Traits

Load each trait as it is relative to what you are working on. For example, if you are writing
Typescript, load the `typescript` trait. When you use a trait, reference the trait that you applied
and why in your explanation of your work to the user. Traits may reference other traits. Traits are
cheap to load, prefer loading to not loading if you're unsure of applicability.

### Protect Your Time

- Apply when: Running shell commands, scripts, or building workflows that you expect other agents to
  invoke (e.g. tests, build-the-lever scripts).
- File: `./references/traits/trait-protect-your-time.md`

### Build the lever

- Apply when: Creating or thinking through ay non-trivial rule, process, or workflow. Create
  reproducible code, rather than running by hand or writing documents.
- File: `./references/traits/trait-build-the-lever.md`

### Prove it works

- Apply when: Proving that your changes work in the real world, rather than relying on checks you
  made up (e.g. tests).
- File: `./references/traits/trait-prove-it-works.md`

### Design from first principles

- Apply when: Don't tack new functionality onto old interfaces that don't fit them. Design how it
  **should** work from first principles, then build that, refactoring when needed.
- File: `./references/traits/trait-design-first-principles.md`

### Fix the root cause

- Apply when: Whenever you fix something. Fix the cause, not the symptom.
- File: `./references/traits/trait-fix-root-cause.md`

### Complexity is a demon

- Apply when: Whenever you are doing something that adds code. Possibly the most important trait in
  the list.
- File: `./references/traits/trait-complexity-demon.md`

### Typescript

- Apply when: Writing Typescript. How to write great Typescript.
- File: `./references/traits/trait-typescript.md`

### Rust

- Apply when: Writing Rust. How to write great Rust.
- File: `./references/traits/trait-rust.md`
