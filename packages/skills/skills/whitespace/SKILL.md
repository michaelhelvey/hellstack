---
name: whitespace
description:
  Adds blank lines between statements in JavaScript and TypeScript files to make the code more
  readable.
disable-model-invocation: true
---

# Whitespace

Blank lines between sections of code make code easier for humans to read. Many AI models do not add
enough blank lines. The script in this skill adds them. It runs `oxlint --fix` with only
`@stylistic/padding-line-between-statements`, with the options of the `require-readable-spacing`
rule from [anti-slop](https://github.com/dmmulroy/anti-slop). It only adds blank lines. It does not
remove lines or change other code.

## Requirements

- `bun` on `PATH`.
- The first run installs oxlint and `@stylistic/eslint-plugin` into `~/.cache/whitespace-skill/`
  (about 15 MB, a few seconds).

## Step 1. Find the files

If the user names files or directories, use them.

If not, use the JavaScript and TypeScript files that you changed in this task. If you do not know
which files you changed, get the changed and new files from git:

```bash
git status --porcelain --untracked-files=all | awk '{print $NF}' \
  | grep -E '\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$'
```

Do not include files that you did not change unless the user tells you to.

## Step 2. Fix the whitespace

Run the script from this skill's directory with all the files in one command:

```bash
bun <skill-dir>/scripts/whitespace.ts path/to/a.ts path/to/b.tsx
```

The script changes the files in place. Exit code 0 means that no problems remain. If the exit code
is not 0, read the oxlint report and tell the user which problems remain.

## Step 3. Format and check

1. If the project has a formatter (for example, Prettier, Biome, or `rs fmt`), run it on the same
   files.
2. Look at the diff (`git diff -- <files>`). The diff must contain only added blank lines. If the
   formatter removed blank lines that the script added, tell the user.
