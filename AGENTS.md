# hellstack

Skills, plugins, and tools for working with AI agents. I keep everything in a single place and then
sync it out to various actual harness directories. This keeps noisy things like skill changes etc
out of my dotfiles directory, and saves me from modifying 3 copies of everything (for claude code,
opencode, and pi, the 3 agent harnesses that I use regularly).

## Layout

This is a bun workspace. Each plugin set (for example, a personal opencode plugin or a personal pi
plugin) is a package in `packages/<name>`.

- Name packages `@agent-stuff/<name>`.
- Each package has a `tsconfig.json` that extends `../../tsconfig.json` and sets its own `include`.
- Refer to other packages with `"workspace:*"` dependencies.
- Run lint, format, type checks, and tests from the repository root.

## Toolchains

- This project uses Rstack CLI for linting and formatting (node_modules/rstack/docs/llms.txt
  locally, or https://rstack.rs/llms.txt online)
- We use exclusively `bun` as our package manager and for all runtime code, including tests
  (https://bun.sh/llms.txt). Do NOT use `rstest` as this will use Node.js as the test runtime and
  will break.
- Note that plugins for different harnesse will have different runtime requirements. For example,
  opencode uses bun to execute plugins, while pi does not (as far as I know).

## References

_These are the source code of various libraries and harnesses that you may find useful during your
work_

- Opencode source code is at ~/dev/thirdparty/opencode
- Pi source code is at ~/dev/thirdparty/pi

## Rules

- Other agents and people can work in the same directory. Do not change unrelated files.
- Don't make git commits unless I explicitly ask you to.
- All documentation and code comments should use ASD-STE100 Simplified Technical English.
- Add doc comments to all public exports from a module. Avoid non-doc comments within code unless
  overwhelmingly necessary to explain an otherwise odd decision that would strike the reader as
  wrong at first glance (e.g. a lint ignore).
- Always run linting, tests, and the code complexity check before you finish.
- Use Zod or similar libraries to parse unknown types. Do not write validation functions such as
  `isRecord` that can be expressed with a zod schema.
- Do not write tautological tests. Asserting that a function that returns a constant string returns
  some substring of that constant string is a useless test. Do not write tests like this or anything
  like them.
- Packages should always include a minimalist README targeted a using the package. READMEs should
  always be short and to the point, focusing on how to use the code in the package, not
  implementation details.
- This repo is public so don't put shit in it that is overly specific to my company (specific links
  etc). Processes are fine to expose, just don't put links to specific repos, jira boards, aws
  resources, etc.
- When writing scripts for skills, it's totally fine to build python scripts that have dependencies,
  just use `uv init --script` to start then and then add whatever you need in the `dependencies`
  block of the comment header.
- If you wanna use JS/TS for a script, use Typescript and Bun. Don't write `.mjs` files for node.
