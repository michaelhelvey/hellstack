---
name: ask-michael
description:
  Sends Michael a question as a Microsoft Teams chat message.
disable-model-invocation: true
---

# Ask Michael

The script in this skill sends Michael a Teams chat message through the Teams web app in Michael's
running Chrome. It only sends. It cannot read the reply.

## Requirements

- `bun` on `PATH`.
- Chrome on macOS, with remote debugging enabled at `chrome://inspect/#remote-debugging`.
- A Teams sign-in at `https://teams.cloud.microsoft` in that Chrome.

The first run installs `puppeteer-core` into `~/.cache/ask-michael-skill/`.

## Step 1. Write the question

Write one short message that Michael can answer without other context:

- Start with the project or repository name, so that Michael knows which session asks.
- Ask one clear question. If there are options, list them and give your recommendation.
- Tell Michael to reply in the agent session, not in Teams.

## Step 2. Send the question

Run the script from this skill's directory. Put the message in quotes:

```bash
bun <skill-dir>/references/ask-michael.ts "hellstack: should I use option A or B? I recommend A. Reply in the agent session."
```

Exit code 0 means that the message is in the chat. The script prints the chat title that Teams
shows.

If the exit code is not 0, read the error:

- `Chrome remote debugging is off...`: tell the user to enable remote debugging.
- `Not logged in to Teams web...`: tell the user to sign in to Teams in Chrome.
- Other errors: tell the user the error text.

Do not send the same question again after an error unless the user tells you to.

## Step 3. Wait for the answer

Tell the user in the session that you sent the question. Then stop and wait for the answer. Do not
continue with the blocked work until Michael answers.
