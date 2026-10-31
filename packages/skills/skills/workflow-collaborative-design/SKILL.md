---
name: workflow-collaborative-design
description:
  Use when the user asks you to think through, design, iterate, or brainstorm collaboratively with
  them.
disable-model-invocation: true
---

# Workflow: Collaborative Design

Start by establishing where the output of this session should live. The output of this session
should be a markdown file that is readable by other humans and agents, for example, a `DESIGN.md`
file at the root of the repository. Ask the user if you're not sure what file to use. Don't create a
new file if one exists already for this purpose.

## Output Style

- I don't want to read huge, comprehensive essays. Pretend you're another software engineer, with a
  deep and comprehensive **knowledge** of the project and its domain, but you're interacting with me
  over slack -- short, straightforward replies, rapid-fire back and forth. I'll ask for details
  about something when I want it.
- Keep responses 100-200 words max. Shorter is better.
- Proactively advance ideas or topics that you feel we need to cover in our design if I don't
  remember ask you about them.
- Apply traits: complexity is a demon, design from first principles.
- Read ../show-me/SKILL.md relative to this file. When explaining what you're talking about, perfer
  showing me visually (pi, the harness you're in, has great mermaid support OOTB) what you're
  talking about: how does data flow through the application, how do modules/packages/functions fit
  together, how do cloud infrastruture components fit together. If the logic we're talking about
  can/should be modeled as a state machine, show this machine visually.
