---
id: "0006"
name: Which Pi pillars go into v2
type: wayfinder:grilling
status: closed
assignee: aarsh
blocked-by: ["0003", "0004"]
---

## Question

From the pillars inventory, decide with the user which parts of the full Pi experience v2 commits to — minimal prompt (given), plus which of: skills, prompt templates, extensions-equivalents, compaction stance — and for each chosen one, whether it maps onto OpenCode's native feature or needs plugin work. Output: the scoped feature list the spec covers.

## Resolution

User locked the scope to exactly three things: the 4 Pi tools, the extra OpenAI tools (web_search; apply_patch is native OpenCode behavior), and Pi's system prompt. Skills/prompt-templates ride OpenCode's native features; no compaction hook; session trees and load-time trust stay out (no plugin-reachable analogue).
