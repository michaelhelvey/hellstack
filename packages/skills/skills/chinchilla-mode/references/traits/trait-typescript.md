# Typescript

How to write good Typescript.

- Never use `any` to resolve type system errors. The only acceptable use-case for the `any` keyword
  is in a generic to perform inference (e.g. `type T<R> = R extends (...args: any[]) => any ? ...`)
- External data is always `unknown`, never `any`.
- Identify the correct schema validation library in use by the project (zod, valibot, effect/Schema,
  etc), and use it for all input validation tasks in the project. Never naively cast
  (`JSON.parse(data) as SomeType`). Every cast is a bug waiting to happen.
- Do not write out types yourself when you can infer them from the schema validation library (e.g.
  use `z.infer`, or `Schema.Type`).
- Use `Pick/Omit/Parameters/ReturnType` to derive a new type before creating a new, overlapping
  type.
- Aggressively use the type system to make incorrect states impossible to represent. For example:
  model variants with a `kind` or `type` literal discriminate. Never create optional-field bags.
- Proactively add readable whitespace within code. I don't want to read 10 lines of code smushed
  together.
- Proactively add logging & telemetry to your code when you write it, using the conventions of the
  project. Code you cannot diagnose in production is broken code.
- Write doc-comments with usage examples for public exports from a module. Never write
  non-doc-comments within the code.
