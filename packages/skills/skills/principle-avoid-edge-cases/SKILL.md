---
name: principle-avoid-edge-cases
description:
  Apply when designing the requirements for a system, to avoid the complexity of handling too many
  edge cases up front.  Create deep modules with simple interfaces, not shallow modules with complex
  interfaces.
disable-model-invocation: true
---

# Avoid Edge Cases in Design

When you're besieged by a lot of edge cases, avoid designing your API around them. Instead, solve
the problem directly and don't expose the existence of edge cases in your design.

Problem:

- You're designing an API that has a simple logical operation, e.g. `(A, B) -> C`, but there's a lot
  of edge cases in how A and B might combine to produce C.
- You might be tempted to expose this in your API design, or spend too much time considering all the
  possible edge cases and blocking meaningful progress on the big picture. Don't do that.

Instead:

- Design the interface around the simple case that most closely models the domain correctly.
  `(A, B) -> C`. Don't block work on handling edge cases.
- Only loop back around to consider edge cases in either your API design or in your requirements
  after you get the simple case done.
- Think about John Ousterhout's "deep modules" principle here.

Edge cases are important, but when you expose them, they leak into the rest of the codebase! We
don't like that.
