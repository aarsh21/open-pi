---
id: "0004"
name: Define what "feels like Pi" means
type: wayfinder:grilling
status: closed
assignee: aarsh
blocked-by: []
---

## Question

v1's second pain point was "the agent didn't feel like Pi." Pin down with the user what that means concretely, as acceptance criteria for v2: Which behaviors broke the feel (todo scaffolding? verbose responses? permission prompts? tool choices?)? What must the v2 agent's responses and tool loop look like to pass? Does Pi's "no permission system" stance mean all OpenCode permission prompts should be disabled for the pi agent? Output: a short checklist the spec's "agent behavior" section is written against.

## Resolution

Locked with the user during the /implement session (2026-07-15): "feels like Pi" = the 4 Pi tools with Pi-similar behavior, Pi's exact default system prompt, no scaffolding tools (todo/task/skill/question denied), no permission prompts (allow-all for the tools pi uses), and token-lean tool output. Byte-exact truncation/continuation fidelity was explicitly ruled unnecessary — OpenCode's built-in tool-output cap does the truncating.
