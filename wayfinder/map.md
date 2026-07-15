---
label: wayfinder:map
name: Open-pi v2 — Pi's philosophy inside OpenCode
---

# Open-pi v2 — Pi's philosophy inside OpenCode

## Destination

**Reached (2026-07-15).** Redrawn by the user mid-effort from "spec, then build" to "build now, lean": open-pi v2 implemented in place — the 4 Pi tools (Pi-similar, token-lean, no custom truncation), the OpenAI `web_search` tool, and Pi's exact default system prompt, as an installable OpenCode plugin. All tickets closed.

## Notes

- Domain: OpenCode plugin development (TypeScript, `@opencode-ai/plugin`), Pi agent harness (vendored at `pi/`), OpenCode docs at `openocode-docs/`.
- v1 pain points driving this effort: (a) overridden read/bash/edit/write were not reliable / faithful to Pi, (b) the agent didn't feel like Pi — too much OpenCode scaffolding, not the minimal focused agent.
- Hard constraint: must remain an installable plugin; aggressive config manipulation, shims, and wrapper CLIs are acceptable; forking or patching OpenCode is not.
- Standing user directives: when the active model is OpenAI, the pi agent exposes `apply_patch` **instead of** `edit`; v2 adds a web-search tool that rides the user's OpenAI subscription/auth when OpenAI models are in use (modeled on https://github.com/nicobailon/pi-web-access).
- This map is planning-only: tickets resolve decisions; the build is a separate effort after the spec. *(Overridden 2026-07-15: the user invoked /implement — execution was carried out directly and the decision tickets were resolved inline.)*
- Simplification directive (2026-07-15): no truncation-fidelity machinery — tools stay Pi-similar but token-lean; OpenCode's built-in tool-output cap does the truncating.
- Tracker: local markdown. Tickets live in `wayfinder/tickets/`, one file each; `status`/`assignee`/`blocked-by` in frontmatter. Frontier = open, unassigned, all blockers closed.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [Web search via OpenAI auth](tickets/0010-openai-web-search-tool.md) — `web_search` plugin tool calls the Responses API `web_search` tool directly, reusing creds from `~/.local/share/opencode/auth.json` (ChatGPT/Codex JWT → chatgpt.com codex endpoint, API key → api.openai.com), registered only when OpenAI creds exist; non-OpenAI-model behavior flagged as an open spec decision.

- [Pi tool fidelity baseline](tickets/0001-pi-tool-fidelity-baseline.md) — full behavioral spec of Pi's read/bash/edit/write extracted; 23-row gap table shows v1's worst divergences are bash execution ($SHELL -lc, unbounded UTF-8-unsafe accumulation, SIGTERM-only kill), edit robustness (no fuzzy match, no BOM/CRLF handling), and read's claimed-but-missing image support.
- [apply_patch for OpenAI models](tickets/0009-apply-patch-for-openai-models.md) — no mechanism needed: OpenCode's tool registry natively swaps edit+write for its built-in Codex-envelope apply_patch on gpt-5.x model ids, filters by tool id (covers plugin overrides), and recomputes per message, so mid-session switches just work; v2 registers Pi's `edit` unconditionally and keeps OpenCode's apply_patch, with the full behavioral spec captured in the ticket.

- [Pi pillars and their OpenCode analogues](tickets/0003-pi-pillars-and-opencode-analogues.md) — Skills, prompt templates, and settings layering map cleanly; minimal prompt, compaction format, and permissive permissions are cheap plugin/config work; extensions' interactive UI needs adaptation; session trees and load-time project trust have no plugin-reachable analogue.
- [OpenCode plugin control surface](tickets/0002-opencode-plugin-control-surface.md) — nearly everything v2 needs is official (same-name tool replacement, blanket `deny` hides tools from the model, `agent.prompt` swaps out the provider prompt, todo/title/task all suppressible, `tool_output` caps configurable); only byte-exact system prompts (experimental `chat.system.transform` hook, `<env>` block otherwise unremovable) and plugin-controlled per-request tool visibility (lean on native gpt/apply_patch swap + per-agent permissions) fall short.
- [Define what "feels like Pi" means](tickets/0004-define-what-feels-like-pi.md) — the 4 Pi tools, Pi's exact prompt, scaffolding denied, no permission prompts, token-lean output; byte-exact truncation fidelity explicitly not required.
- [Reuse Pi packages or port the code](tickets/0005-reuse-pi-packages-or-port.md) — port into the plugin (edit engine, paths, mutation queue, bash semantics); truncation machinery dropped per the simplification directive.
- [Which Pi pillars go into v2](tickets/0006-which-pi-pillars-in-v2.md) — exactly three: Pi tools, OpenAI extras (web_search; apply_patch is native), Pi's system prompt; everything else rides OpenCode natively or stays out.
- [System prompt strategy](tickets/0007-system-prompt-strategy.md) — `agents/pi.md` carries Pi's default prompt verbatim (minus pi-docs block and cwd line); stable APIs only, no experimental hook.
- [Web search gating](tickets/0011-web-search-gating.md) — credentials-based registration; re-read auth.json per call; friendly re-connect message on 401.
- [Draft the open-pi v2 spec](tickets/0008-draft-open-pi-v2-spec.md) — superseded: user redrew the destination to "build now"; the implementation plus closed tickets are the de-facto spec.

## Not yet specified

*(empty — the destination is reached; the two former entries here — fidelity verification and installer rework — were resolved by the simplification directive: vitest suite covers the lean tools, and the installer needed only the Exa option removed.)*

## Out of scope

- Forking or patching OpenCode itself — ruled out by the integration constraint.
- Improving Pi upstream or building a standalone Pi CLI — users who want raw Pi can run Pi.
- Pi's non-coding-agent packages (`pi-chat`, orchestrator, tui) — the destination is the coding agent inside OpenCode.
