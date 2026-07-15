---
id: "0007"
name: System prompt strategy
type: wayfinder:grilling
status: closed
assignee: aarsh
blocked-by: ["0002", "0004"]
---

## Question

How is the pi agent's system prompt composed in OpenCode so the model sees Pi's minimal prompt and not OpenCode's scaffolding? Decide, given the control-surface findings: full replacement vs agent prompt + suppression tricks; whether to generate the prompt from Pi's `buildSystemPrompt` logic (tools list, guidelines, project context, cwd) or hand-maintain `agents/pi.md`; and how project context files (AGENTS.md etc.) flow in. Output: the spec's prompt-composition design.

## Resolution

Agent prompt + config, stable APIs only. `agents/pi.md` carries Pi's default system prompt verbatim as composed by `buildSystemPrompt()` for [read, bash, edit, write] — identity line, tool snippets, guidelines — minus the pi-docs pointer block (paths don't exist here) and the cwd line (OpenCode's env block provides it). Generated from `src/agentDefinition.ts` at build time via `syncAgent`. AGENTS.md flows in through OpenCode rules natively. The experimental `chat.system.transform` hook was not used.
