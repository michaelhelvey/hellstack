---
name: principle-read-the-source
description:
  Apply when you want to investigate a dependendency or deeply understand code that is not yours.
disable-model-invocation: true
---

# Read The Source

When you are working with a 3rd party library or tool, and that tool does not include the source in
the current working directory (e.g. the published NPM package contains only bundled code, the tool
is a CLI, etc), clone the code from the remote forge into `~/dev/thirdparty/<tool-name>` in order to
more fully understand it. In an Amp orb, use `~/thirdparty/<tool-name>`.

1. If the tool is already present in the `thirdparty` directory, do not reclone it. Ensure that it
   is on the main branch and fetch latest.
2. Always use `--depth 1` when cloning to avoid bloating the version control system with diffs that
   we will never inspect.
3. If you install project dependencies, or build the project (e.g. creating a Rust target
   directory), clean up after yourself when you are done to avoid cluttering the disk with large
   temporary artifacts.

## Upstream Hygiene

Never suggest creating a PR or issue against an upstream repository. Never autonomously create a PR
or issue against an upstream repository. If the user chooses to do this, or explicitly instructs you
to do so, that is fine, but don't autonomously suggest or do it.
