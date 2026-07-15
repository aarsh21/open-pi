---
id: "0009"
name: apply_patch for OpenAI models
type: wayfinder:research
status: closed
assignee: research-agent
blocked-by: []
---

## Question

User directive: when the active model is an OpenAI model, the pi agent should expose an `apply_patch` tool **instead of** `edit` (edit removed from the pi tool set). Research what the spec needs to design this:

- The `apply_patch` format OpenAI models are trained on (Codex-style patch envelope): exact syntax, multi-file support, add/update/delete semantics, error handling. Check whether Pi or OpenCode already ships an apply_patch implementation to borrow.
- How OpenCode determines the active model/provider at tool-resolution time, and every mechanism a plugin has for swapping tool availability per model (dynamic tool registration, hooks, per-agent config keyed by model, config tricks). Overlaps ticket 0002's dynamic-tools row — go deeper here on the concrete mechanism.
- Fallback story: what happens on mid-session model switches between OpenAI and non-OpenAI models.

Output: the mechanism recommendation + apply_patch behavioral spec, ready to fold into the v2 spec.

## Resolution

### Headline finding: OpenCode already does the swap natively

OpenCode's tool registry (`packages/opencode/src/tool/registry.ts`, `ToolRegistry.tools()`) hard-codes exactly the directive's behavior:

```ts
const usePatch =
  input.modelID.includes("gpt-") && !input.modelID.includes("oss") && !input.modelID.includes("gpt-4")
if (tool.id === ApplyPatchTool.id) return usePatch
if (tool.id === EditTool.id || tool.id === WriteTool.id) return !usePatch
```

- When the active model's API id matches `gpt-*` (excluding `*gpt-4*` and `*oss*` — i.e. gpt-5.x families incl. gpt-5-codex), the model sees `apply_patch` and does **not** see `edit` or `write`. All other models see `edit`+`write` and no `apply_patch`.
- Filtering is by **tool id**, applied to built-ins *and* custom/plugin tools alike, before the final tool map is built (`session/tools.ts` assigns `tools[item.id] = ...`, custom overrides built-in on id collision). So a plugin tool named `edit` is auto-hidden for GPT-5 models and a plugin tool named `apply_patch` is auto-shown — the swap comes for free.
- `ToolRegistry.tools({providerID, modelID, agent, ...})` is invoked inside the per-message prompt loop (`session/prompt.ts` → `SessionTools.resolve({model, ...})`), i.e. tool availability is recomputed **on every message step from the message's current model**.

### Mechanism recommendation

**Ride the native registry filter; do not build a gating mechanism.** The v2 plugin ships Pi-faithful custom tools under both ids:

1. `edit` — Pi's exact string-replace edit (from `pi/packages/coding-agent/src/core/tools/edit.ts` semantics).
2. `apply_patch` — a Codex-envelope patch tool with Pi's error style (spec below).

Both stay registered at all times (`tool: {...}` in the plugin hooks object, or `.opencode/tools/` files); OpenCode's model gate decides visibility per message. No fork, no config trick needed.

Why not the alternatives (feeds ticket 0002's matrix):
- **No plugin hook can vary the tool set per request.** The hook surface (`@opencode-ai/plugin` `Hooks`) offers `tool.definition` (mutate description/params only), `chat.params` (sampling params only), `tool.execute.before/after` (intercept execution, cannot hide a tool from the model). Static `tool:` registration is model-blind.
- **Agent `tools` config** (deprecated) and `permission` are static per agent, not per model; worse, `apply_patch`, `edit`, and `write` are all gated by the single `edit` permission (tools.mdx, agents.mdx), so permissions cannot express "apply_patch yes, edit no".
- **Overriding the registry condition** (e.g. gating on `providerID === "openai"` instead of the `gpt-` id heuristic) is impossible without a fork. Accept OpenCode's gate as the operative definition of "OpenAI model". Known deltas to note in the spec: models with ids lacking `gpt-` (o3/o4-mini, codex-mini) keep `edit`; gpt-5.x served via Azure/OpenRouter get `apply_patch` (id still contains `gpt-`); `gpt-oss-*` keeps `edit`.
- **Directive delta:** OpenCode removes `write` as well as `edit` when `apply_patch` is active. This is correct behavior (it matches OpenAI's own tool lineup — file creation goes through `*** Add File:`) and the spec should adopt it rather than fight it.

Implementations to borrow (in preference order):
1. **OpenCode's own built-in** — `packages/opencode/src/tool/apply_patch.ts` + parser `packages/opencode/src/patch/index.ts` + prompt `apply_patch.txt`. Battle-tested, MIT, TypeScript; v2 may even keep the built-in as-is if fidelity review finds no Pi-semantics gap (then the plugin only replaces `edit`/`write`, and `apply_patch` needs no override at all — recommended default posture).
2. **`code-yeongyu/pi-apply-patch`** (MIT) — Codex-style apply_patch extension for Pi, ported from a Pi builtin `gpt-apply-patch` extension; useful as the Pi-flavored reference. The Pi checkout vendored at `pi/` contains **no** apply_patch (only the extension framework under `core/extensions/`); its tool set is bash/edit/find/grep/ls/read/write.
3. openai/codex `codex-rs/apply-patch` — the canonical Rust reference and tool instructions.

### apply_patch behavioral spec (v2)

Tool: `apply_patch`; single required string arg `patchText` ("The full patch text that describes all changes to be made"). Description = the Codex envelope primer (OpenCode's `apply_patch.txt` wording is fine).

**Envelope grammar** (one patch = one call, multi-file supported):

```
*** Begin Patch
[ one or more file sections ]
*** End Patch
```

File section headers (paths always relative to project root; absolute paths rejected):
- `*** Add File: <path>` — create file; every following line must be `+`-prefixed initial content.
- `*** Update File: <path>` — modify in place; optionally followed immediately by `*** Move to: <newpath>` (rename). Body is one or more hunks.
- `*** Delete File: <path>` — remove file; nothing follows.

Hunk format inside Update: `@@` optionally followed by a context string (e.g. `@@ def greet():`) that seeks forward to that line before matching; then lines prefixed ` ` (context), `-` (remove), `+` (add). `*** End of File` after a hunk anchors the match at EOF. Multiple `@@` hunks per file proceed top-down (match cursor never rewinds).

**Context matching** (per OpenCode's parser, 4 relaxation passes): exact match → trailing-whitespace-insensitive → fully trimmed → Unicode-normalized+trimmed. First pass that matches wins; on failure the hunk errors. Heredoc wrappers (`apply_patch <<"EOF" ... EOF`) around the envelope are tolerated and stripped.

**Execution semantics:**
- Verify-then-write: parse and resolve **all** hunks against current file contents first; any failure aborts the whole patch with no files touched (all-or-nothing).
- Add: creates parent dirs; content is the `+` lines, newline-terminated. Update: applies chunks; preserves BOM. Move: write new path, delete old. Delete: remove file.
- One permission ask covering all touched paths, under the `edit` permission with the combined diff as metadata.
- Post-write: formatter hook runs, file-edited/watcher events publish, LSP diagnostics for touched files are appended to output (`LSP errors detected in <file>, please fix:`) — matching v2's `edit` pipeline so both paths stay symmetric.
- Success output: `Success. Updated the following files:` then one `A|M|D <relpath>` line per file.
- Error style (all errors are tool-result strings the model can react to, Pi-style, no exceptions escaping): `apply_patch verification failed: <reason>` for parse/match failures; `patch rejected: empty patch` for an empty envelope; `Failed to read file to update: <path>` for updates to missing files; `Failed to find context '<ctx>' in <path>` for context misses.

### Mid-session model switches (fallback story)

No plugin work required. Because `SessionTools.resolve` recomputes the tool set from the current model on every message step:
- Claude → GPT-5.x: next turn the model sees `apply_patch`, loses `edit`/`write`.
- GPT-5.x → Claude: next turn `edit`/`write` return, `apply_patch` disappears.
- Historical `apply_patch`/`edit` tool calls remain in the transcript; that is harmless (providers accept tool-call history for tools not currently offered). If a model hallucinates the now-hidden tool, OpenCode's `invalid` tool catches unknown-tool calls and returns an error the model recovers from.
- Spec requirement: keep both Pi tools registered unconditionally (never conditionally register at plugin init — plugin init sees no model, and the registry filter already handles visibility); never cache the tool set across turns.
