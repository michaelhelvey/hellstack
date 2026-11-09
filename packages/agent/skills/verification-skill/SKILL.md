---
name: verification-skill
description:
  Creates or maintains a project-local verification skill that drives an app the way a user does,
  locally and in each deployed environment (for example alpha, beta, prod). The generated skill
  knows how to launch, deploy, access, and verify the app in every environment. Use for
  "/verification-skill", "make a verify skill for this repo", or "audit the verify skill".
argument-hint: "[create|maintain] [app or guidance...]"
disable-model-invocation: true
---

# Verification skill

Every serious project needs a scripted way to drive the real app and prove behavior: start it, use a
feature the way a user does, and capture evidence. A local proof is not sufficient. The question
that users ask most is "does this work in alpha?", so the generated skill must also know how to
deploy the app, how to get access to each deployed environment, and how to run the same journeys
against it.

This skill generates that skill, and it keeps it correct as the app and its infrastructure change.
You write the output for the next agent, not for a human. That agent reads it cold, during a task,
and has never seen the app.

## Arguments

Usage: `/verification-skill [create|maintain] [app or guidance...]`

The arguments are: `$ARGUMENTS`

If the line above is empty or shows a literal placeholder, read the arguments from the user message
that comes after this skill.

Find the target: a project-local skill whose body has launch, environment, and drive sections and a
feature map, usually `.agents/skills/verify-*/` (also look in `.pi/skills/`, `.claude/skills/`, and
`.cursor/skills/`).

- No target, or the user says `create`: do [Create](#create).
- One target, or the user says `maintain`: do [Maintain](#maintain).
- More than one target: ask the user which one.
- A target exists but has no environment files: do [Maintain](#maintain), and treat each missing
  deployed environment as drift.

Read [the generated skill contract](#the-generated-skill-contract) before you do either mode. Both
modes produce a skill that obeys it.

## The generated skill contract

The generated skill lives in `.agents/skills/verify-<app>/`:

```
verify-<app>/
  SKILL.md
  environments/
    README.md        # index: one row per environment
    local.md
    <env>.md         # one file per deployed environment, e.g. alpha.md
  features/
    README.md        # index and driving conventions
    <feature>.md     # one file per user-facing feature
  scripts/           # optional helpers
```

Follow the shapes in [`references/environment-example/`](references/environment-example/) and
[`references/feature-map-example/`](references/feature-map-example/).

### `SKILL.md`

YAML frontmatter with `name: verify-<app>` and a `description` that names the app, its surfaces, its
environments, and when to use it. Include phrases such as "is it working in alpha" and "verify this
change". Do not set `disable-model-invocation`: agents must find this skill without a slash command.
Without frontmatter the skill does not register.

The body has these sections. Each one comes from what you found in the repo. Do not leave
placeholders.

- **Environments.** A table: name, purpose, URL or entry point, how code gets there (CI on merge,
  manual deploy, preview per PR), mutation policy, and a link to the environment file. The mutation
  policy is one of `free` (disposable data), `tagged` (writes allowed only to data that the run
  creates and marks as test data), or `read-only` (no writes, usually prod).
- **Answer "is it working in `<env>`?"** The procedure for a deployed environment, in this order:
  1. Doctor the environment.
  2. Find the deployed version (commit SHA, image tag, release name) and compare it with the commit
     the user cares about. If the change is not deployed, say so and stop. Do not report a pass for
     code that is not there.
  3. Drive the feature journeys that the environment file permits.
  4. Look at the logs and the error tracker for the time window of the run.
  5. Report per feature: `verified`, `failed` (with evidence), or `verified-unreachable` (with the
     missing prerequisite).
- **Launch (local).** The exact command that starts the app, and how to know that it is ready.
  Launch must get to a usable state from an empty data directory, with migrations and seed data.
  Ready means usable, not only that a process answers. A database health check can pass while init
  scripts still run. For a short-lived CLI or TUI, launch means build once, then start each drive in
  its own isolated PTY or tmux session.
- **Deploy.** For each deployed environment: the command or workflow that deploys it, what it
  deploys (current branch, a merged commit, an image tag), how to watch it finish, and how to roll
  back. If deploys only happen through CI, give the workflow name and how to trigger and watch it
  (for example `gh workflow run` and `gh run watch`). State that a deploy to a shared environment is
  an outward-facing action: the agent asks the user first unless the user told it to deploy.
- **Access.** For each environment: how to get credentials and connectivity, with exact commands.
  Cover each kind of access the journeys need: the site or API (login flow, test accounts, tokens),
  databases (client, host, how to get the password), queues and storage, logs, metrics, and the
  error tracker. Include network prerequisites (VPN, bastion, port forward). Name where each secret
  comes from (a secret manager path, a CLI login, an environment variable). Never write a secret
  value into the skill.
- **Doctor.** One read-only check per environment that answers "is this instance worth driving?":
  the process or service is up, the version is the expected one, credentials are valid, and the
  network path works. For local, also confirm that this run owns the port. An agent runs doctor
  first and after any surprise.
- **Drive.** The harness recipe with real selectors and commands from this repo, not examples.
  Prefer stable handles (ARIA labels, data attributes, prompt strings, route paths) to coordinates
  and tab order. Parameterize the target, for example with a `BASE_URL` or `--env` flag, so that one
  recipe drives every environment. Where a journey cannot run in an environment, the feature file
  says why.
- **Evidence.** What to capture for a proof and where it goes. Use a directory that git ignores or
  that is outside the repo, with one subdirectory per run and environment. Proof standards:
  - Use the real user path, not internal setters or test-only endpoints.
  - Capture the action and the result, not only the final screen.
  - Verify side effects (files, rows, messages) as well as what is visible. In a deployed
    environment, read side effects through the access paths in the environment file.
  - Use mocks only where a production boundary already isolates the external system.
  - If the safe path is a dry run or test mode, observe what it really skips (files, network, git
    refs). Some dry runs still use the network or open a browser.
  - Record the environment and the deployed version with every artifact.
- **Cleanup.** How to remove what the run made. Locally: stop the instances that this run started.
  Never kill by process name. In a deployed environment: delete the tagged test data that this run
  made, and nothing else. Cleanup never removes evidence.
- **Helpers.** Each script that the skill ships is executable, and the skill body shows how to call
  it. Prefer one helper with an `--env` flag to one helper per environment.

### `environments/`

`README.md` is the index. Each environment file uses the H2s in
[`references/environment-example/alpha.md`](references/environment-example/alpha.md): `Deploy`,
`Access`, `Doctor`, `Driving differences`, `Mutation policy`, `Observability`, and `Gotchas`. The
`local.md` file has the same H2s. Its `Deploy` section is the local launch.

### `features/`

`README.md` is the index and the driving conventions. Each feature file answers, from the user's
point of view: what the feature is, how to get to it, how to drive it, which environments can prove
it, and what end state proves it works. The H2s are `Sub-features`, `How to get to it (user POV)`,
`Driving it with <harness>`, `Environments`, and `Gotchas`.

If the seed data in an environment does not have a precondition that a journey needs, the journey
reports a failure and the reason goes in `Gotchas`. Never make a journey weaker so that it passes. A
proof that drives one convenient entry point is incomplete when the map lists others.

## Create

### 1. Interview the repo, not the user

Get these answers from the codebase. Ask the user only for what you cannot see.

- **Surface.** What does a user touch? A web UI, a CLI or TUI, a desktop app, an API, a mobile app,
  a library? Pick the primary one and record the others.
- **Run.** How does the app start locally? Prefer the repo's documented dev command (package
  scripts, Makefile, README). Record ports, environment variables, seed data, and auth.
- **Environments.** Which deployed environments exist? Look at IaC (Terraform, CDK, SST, Pulumi,
  Helm, Kubernetes manifests, serverless configs), CI and CD workflows, deploy scripts, per-stage
  config files, and README files. Record each stage name, URL, account or cluster, and region.
- **Deploy.** How does code get to each environment? Find the trigger (merge to a branch, tag,
  manual workflow, local command), the command, how to watch it, and how to roll back. Find how to
  read the deployed version (a version endpoint, a health payload, an image tag, a release record).
- **Access.** How does an agent get in? Find the auth flow and test accounts for the site, the
  database clients and connection paths, the cloud CLI profiles, the log and error tracker queries,
  and the network prerequisites. Look for existing skills, scripts, and docs on the machine that
  already do this (for example a database skill in `~/.pi/agent/skills/`). Link to them. Do not copy
  them.
- **Drive.** How can an agent use the app? Use existing harnesses first: Playwright or Cypress
  specs, expect scripts, PTY helpers, endpoints that curl can call, a debug port. Then pick a
  generic recipe: a browser or CDP for web and Electron, tmux or a PTY for a CLI or TUI, HTTP for
  services. Check that the harness can point at a deployed URL. End-to-end specs often hard-code
  `localhost`.
- **Observe.** What evidence can you capture? Screenshots, terminal transcripts, response bodies,
  logs, exit codes, database state, error tracker events.
- **Isolate.** Can two local instances run side by side (ports, data directories, profiles)? If not,
  the generated skill says so. In a deployed environment, how does a run keep its data apart from
  real users and other runs (a test tenant, a name prefix, a flag)?

Use one question tool call, with all questions, for the facts that you cannot see, for example the
VPN, the account to use, the test credentials, and which environments the agent may deploy to.

If the checkout does not build or start, fix that first or report it exactly. A skill written
against a broken base teaches wrong steps. If an unrelated missing asset blocks startup (a static
directory the API never serves, a sample config), the generated skill can create it. Mark it as
verification scaffolding and remove it in cleanup.

### 2. Generate the skill

Write the files in [the generated skill contract](#the-generated-skill-contract).

### 3. Seed the feature map

Make one feature file per user-facing feature you can find. Start with the top 3 to 5, from routes,
commands, menus, or docs. Fill in the `Environments` section of each from the mutation policies: a
journey that writes cannot run in a `read-only` environment, so give a read-only alternative or mark
the environment as not covered and say why.

### 4. Prove the generated skill

Run its instructions end to end. A generated skill that nobody ran is a draft, not a deliverable.

1. **Local.** Launch, doctor, drive ONE mapped feature, capture evidence, clean up. After cleanup,
   confirm that the evidence is still at the named location.
2. **Each deployed environment.** Doctor, read the deployed version, drive one journey that the
   mutation policy permits, capture evidence, clean up the tagged data. Prefer a read-only journey.
   If access fails because of a missing prerequisite (VPN, login), ask the user to fix it once. If
   it still fails, record it as unverified.
3. **Deploy.** Do not deploy to a shared environment to prove the skill unless the user says yes.
   Prove the deploy path with what is safe: a plan or diff (`terraform plan`, `cdk diff`), a dry
   run, or the record of the last successful deploy run. Mark the deploy steps that you did not run
   as unverified.

Fix what fails. Run the generated cleanup after each failed attempt, so that broken attempts do not
leave processes, ports, or test data. If you used a stand-in for the real target (a container for a
VM, a local stack for a remote one), list each setup step that the stand-in did and the target will
not. Those steps stay unverified until a run on the real target covers them.

### 5. Report

Give the user the path of the skill, the environments it covers, what you proved in each
environment, and what stays unverified. Tell them that `/verification-skill maintain` keeps it
correct.

## Maintain

A feature map and an environment map become wrong when the app or its infrastructure changes. The
unit of rigor is the feature and the environment, not each sentence. Cover each feature file from
source, cover each environment file from the infrastructure code, and use each feature live. Do not
run a terminal command for each bullet.

### Outcomes

Pick one, and say which:

- **clean**: each feature and environment got source and live coverage, and nothing needs a change.
- **changed**: you made proven corrections to the skill.
- **blocked**: coverage could not finish, or a proven fix could not be made safely. Say exactly what
  blocked it.

### Edit scope

Edit only the verification skill's directory (its `SKILL.md`, `environments/`, `features/`, and
scripts). Never edit product or infrastructure code during a pass. If the map describes a behavior
that the app no longer has, that is doc drift (fix the map) or a product regression (report it, do
not hide it in the docs). Do not make a commit or a PR unless the user asks.

### Pass

1. **Index hygiene.** Read both index files and list the sibling files. Fix missing, extra,
   duplicate, or dead entries.
2. **Source wave.** Start one read-only subagent per feature file and one per environment file, at
   the same time. If you cannot start subagents, do the reads yourself, one file at a time.
   - A feature reader explains how the feature works from source, flags likely drift with citations,
     and returns one live recipe.
   - An environment reader explains how the environment is deployed and accessed from IaC, CI, and
     config, flags drift (a new or removed stage, a changed URL, a changed auth flow, a new deploy
     workflow), and returns one doctor recipe.
   - Readers never drive the app, never use credentials, and never edit files.
   - Return shape: summary, source entry points, likely drift or none, one recipe.
3. **Reconcile.** Each file has a returned summary. Merge recipes that overlap into as few app
   states as practical. Spot-check the drift that readers cite. Do not prove again the claims that
   are clean. Look at recent commits for user-facing surfaces and environments that are not in the
   map. Before you call one missing, find a concrete source path.
4. **Live pass, local.** Required, also when the source looks clean. You do all the driving. Follow
   the skill's launch model: one long-lived instance driven serially for servers and UIs, or a new
   isolated session per drive for short-lived CLIs. Use each feature at least once. Keep
   [the live invariants](#live-invariants) for the full pass.
5. **Live pass, deployed.** For each deployed environment: doctor, read the deployed version, and
   drive each feature that the mutation policy permits. Do not deploy unless the user says yes. If
   the deployed version is old, record it and drive what is there. A journey that fails only because
   the deployed version is older than the source is not drift: record the version.
6. **Triage.**
   - A wrong or missing user-POV description is doc drift. Fix it.
   - A wrong deploy, access, or doctor step is environment drift. Fix it and run it again.
   - A behavior that works but that the harness cannot drive is a harness gap. Fix it. Harness fixes
     obey the helpers rule, and you drive them live again before you keep them.
   - App behavior that is broken is a product gap. Record it for the user. Do not change the skill
     to hide it.
   - A behavior that is broken in one environment only is an environment gap (config, data,
     infrastructure). Record it for the user with the evidence from both environments.
7. **Report.** Re-read each changed file. Give the outcome, the coverage per environment, the
   unreachable prerequisites, the drift that you fixed, and the product and environment gaps.

Keep short run notes in a scratch location. Do not commit them.

### Live invariants

Whatever fails, keep these for the full pass:

1. Never drive an instance that you have not doctored since it last did something surprising. Doctor
   before the first drive, on each new session where sessions are the unit, and again after a failed
   drive. Where doctor cannot see the failure (a stuck UI state on a healthy process), reset to a
   known state or relaunch.
2. The evidence that you captured survives each cleanup. Check it at its named location.
3. Nothing that a drive started outlives its use. Clean the residue of failed attempts, also when
   the session is stuck, exited, or shared. For a shared instance or a deployed environment, clean
   the residue, not the instance.
4. In a deployed environment, obey the mutation policy. A `read-only` environment gets no writes,
   also when a journey fails and a write looks like the fix.

If doctor fails because the skill is wrong, that is drift. Fix it in the edit scope and try once
more. Restart only what the fix made invalid. If it still fails, the pass is `blocked`. A feature is
`verified-unreachable` only with the concrete prerequisite (auth, entitlement, OS, network, external
state) and the route you tried. If the map does not name that prerequisite, that is drift.
