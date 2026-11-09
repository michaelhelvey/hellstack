A rewrite of hellstack. If you're in this CWD and I say hellstack without specifying, I certainly
mean this repository, NOT ~/dev/helvetici/hellstack. We'll rename this later.

## Toolchains

- Use Vite+ (`vp`) for linting, formatting, and type checks. Configure it in `vite.config.ts`.
- Use bun for package management and runtime code, including unit tests (https://bun.sh/llms.txt)
- This is a bun workspace monorepo. Packages live in `./packages/*`. Put shared dependency versions
  in the `catalog` of the root `package.json` and refer to them with `"catalog:"`.
- Use Effect (v4) for application code. The Effect source and docs are at `~/dev/thirdparty/effect`
  (start with `LLMS.md`). Do not use other copies of the Effect docs, because they can be out of
  date.
- `@effect/tsgo` patches TypeScript and oxlint on `bun install` (the `prepare` script). The patched
  TypeScript is the editor LSP, and `vp check` runs the Effect lint rules (`effecttsgo/*`).

## Packages

- `packages/agent`: the harness-neutral agent: `AGENTS.md`, `layers`, `skills`, and `bun run setup`,
  which installs them and the config of each harness (`src/harness.ts`) into pi and OpenCode. Write
  skills so that they work in both harnesses.
- `packages/pi`: the pi extension and the pi settings.
- `packages/opencode`: the OpenCode config.
- `packages/jira`: the Jira and Confluence MCP server (`src/mcp.ts`). Both harnesses start it from
  their MCP config, and call its tools from codemode.

## General Rules

- Pi loads the extension from the bundle `packages/pi/dist/index.js` (see
  `packages/pi/src/build.ts`). After you change extension code, run `bun run build` so that pi loads
  the change.

- Always validate your work via all relevant checks (`bun run validate`) before declaring your work
  done.
- Keep relevant documentation up-to-date when you change code. This does _not_ mean you must _add_
  documentation for every change, it just means that if there is existing documentation affected by
  your change, then you should update it.

## Typescript Rules

- All documentation and code comments should use ASD-STE100 Simplified Technical English.
- Add doc comments to all public exports from a module. Avoid non-doc comments within code unless
  overwhelmingly necessary to explain an otherwise odd decision that would strike the reader as
  wrong at first glance (e.g. a lint ignore).
- Always use `effect/Schema`, `zod`, `Typebox`, or whatever is appropriate given the context, to
  parse unknown types, rather than casting.

## Testing Rules

- Do not write tautological tests. Tests must assert something meaningful about the system that they
  test which cannot be trivially derived from the literal tokens in the code.
- Do not write code that requires module mocks in order to test -- use proper dependency injection.
  Creating `mock` functions from `bun:test` in order to assert how they are called is allowed.

## References

- Effect source (not sure if we're going to be using effect here yet or not but anyway):
  ~/dev/thirdparty/effect
- Pi source: ~/dev/thirdparty/pi
- OpenCode source: ~/dev/thirdparty/opencode
