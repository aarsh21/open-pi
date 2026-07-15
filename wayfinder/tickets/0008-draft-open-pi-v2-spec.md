---
id: "0008"
name: Draft the open-pi v2 spec
type: wayfinder:prototype
status: closed
assignee: aarsh
blocked-by: ["0005", "0006", "0007", "0009", "0010", "0011"]
---

## Question

Draft the v2 spec — the destination artifact — for the user to react to and iterate on: architecture (plugin layout, tool implementations, prompt composition), the fidelity contract from the baseline, the chosen pillars, model-conditional tooling (OpenAI `apply_patch`, OpenAI web search), installer/config changes, and the verification approach. A rough complete draft beats a polished partial one; the reaction rounds refine it.

## Resolution

Superseded by direct implementation: the user invoked /implement, redrawing the destination from "spec, then build" to "build now". v2 was implemented in place (commit on main, 2026-07-15): lean Pi tools (`read`, `bash`, `edit`, `write`), credentials-gated `web_search` via OpenAI, Pi's exact default system prompt in `agents/pi.md`, simplified installer (default-agent prompt + todo question), vitest suite. The closed research/decision tickets serve as the de-facto spec.
