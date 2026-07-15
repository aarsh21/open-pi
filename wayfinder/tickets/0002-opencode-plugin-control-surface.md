---
id: "0002"
name: OpenCode plugin control surface
type: wayfinder:research
status: closed
assignee: research-agent
blocked-by: []
---

## Question

How much can an OpenCode plugin (plus config tricks — no fork) actually control? From `openocode-docs/` (plugins.mdx, custom-tools.mdx, agents.mdx, config.mdx, permissions.mdx, sdk.mdx, tools.mdx, models.mdx) and, where docs are thin, the opencode source/SDK, produce a capability/constraint matrix covering:

- **Tool replacement**: can a plugin fully replace built-in `read`/`bash`/`edit`/`write` (schema + description + implementation), or only wrap/intercept them? What do `tool.execute.before/after` hooks allow?
- **System prompt**: what does OpenCode inject around an agent's `prompt`? Can a plugin or agent config fully replace the system prompt (no OpenCode scaffolding), e.g. via chat hooks or experimental options?
- **Suppressing built-ins**: do `deny` permissions remove tools from the model's view entirely, or just block execution? Can todo/task/title-generation and other scaffolding be silenced?
- **Dynamic/conditional tools**: can tool availability vary at runtime — per model, per provider, per session? (Feeds the OpenAI `apply_patch` requirement.)
- **Auth/provider access**: what can a plugin see of the active model, provider, and credentials? (Feeds the OpenAI web-search requirement.)
- **Output limits**: any caps OpenCode imposes on tool output that would fight Pi's truncation policy.

For each: supported officially / possible via config trick / impossible without fork.

## Resolution

Ratings: **[official]** = documented/supported, **[trick]** = possible via config/undocumented-but-stable mechanism or experimental hook, **[fork-only]** = impossible without forking OpenCode.

Evidence sources: local `openocode-docs/*.mdx`, plus opencode source at `github.com/anomalyco/opencode` (branch `dev`; sst/opencode redirects there): `packages/plugin/src/index.ts` (hooks), `packages/plugin/src/tool.ts` (ToolDefinition), `packages/opencode/src/session/llm/request.ts` (system assembly + tool filtering), `packages/opencode/src/permission/index.ts`, `packages/opencode/src/tool/registry.ts`, `packages/opencode/src/tool/truncate.ts`, `packages/opencode/src/agent/agent.ts`, `packages/opencode/src/session/prompt.ts`.

### 1. Tool replacement (read/bash/edit/write) — **[official]** full replacement

- A custom tool with the same name **fully replaces** the built-in: its own description, Zod/JSON schema, and implementation. `custom-tools.mdx` ("Name collisions with built-in tools": "If a custom tool uses the same name as a built-in tool, the custom tool takes precedence", with an explicit `.opencode/tools/bash.ts` replacement example) and `plugins.mdx` ("If a plugin tool uses the same name as a built-in tool, the plugin tool takes precedence"). Delivery: `.opencode/tools/<name>.ts` files or the plugin `tool: { name: tool({...}) }` hook.
- Replacement tools get `ToolContext` = `{ sessionID, messageID, agent, directory, worktree, abort, metadata(), ask() }` (`plugin/src/tool.ts`). `ask()` routes through OpenCode's permission system, so a replacement tool can still participate in allow/ask/deny. **Not** in the context: active model/provider (see §5).
- Wrap-only alternative: `tool.execute.before` (mutate `output.args`, or `throw` to block) and `tool.execute.after` (mutate `title`/`output`/`metadata`) — `plugins.mdx` examples; hook signatures in `plugin/src/index.ts`. `tool.definition` hook mutates a built-in's **description and parameters** without touching its implementation (`plugin/src/index.ts`; applied in `tool/registry.ts` before the model sees the schema).
- Caveat: replacing `edit`/`write` by name does not remove OpenCode's model-conditional swap to `apply_patch` on gpt-5.x ids (see ticket 0009); registry filtering is by tool id and covers plugin overrides.

### 2. System prompt control — **[official]** for the agent prompt; **[trick]** (experimental hook) for full replacement

What OpenCode assembles per request (`session/llm/request.ts` `prepare()`):

```
system = [ (agent.prompt ? [agent.prompt] : SystemPrompt.provider(model))   // header
         + input.system  (environment <env> block, instructions/AGENTS.md, MCP instructions, skills list)
         + user.system ].join("\n")
```

- Setting an agent `prompt` (agents.mdx "Prompt") **replaces** the built-in provider prompt (anthropic.txt/codex.txt/etc — chosen per model id in `session/system.ts`). It does **not** remove the appended scaffolding: the `<env>` block ("You are powered by the model named …, Working directory…, Today's date…" — `session/system.ts` `environment()`), AGENTS.md/instructions, MCP instructions, and the skills section.
- Scaffolding minimization by config: no AGENTS.md/instructions files → no instruction text; no skills → skills section only appears when skills exist, and is suppressed when `skill` permission is `deny` (`system.ts`: `if (Permission.disabled(["skill"], agent.permission).has("skill")) return`); MCP instructions only with MCP servers. The `<env>` block is unconditional.
- **Full replacement**: the `experimental.chat.system.transform` hook receives `{ sessionID, model }` and the mutable `{ system: string[] }` and may rewrite it arbitrarily, including clearing and replacing everything (hook typed in `plugin/src/index.ts`; triggered in `session/llm/request.ts` after assembly, before the request). Rated [trick] because it is under the `experimental.` namespace ("may change or be removed without notice", config.mdx "Experimental"), and note the repo's CONTEXT.md flags it as a legacy hook with no V2 equivalent decided yet. `experimental.chat.messages.transform` similarly rewrites the message array (`session/prompt.ts` line ~1255).
- Compaction prompt: fully replaceable via `experimental.session.compacting` `output.prompt` — documented in plugins.mdx ("completely replaces the default compaction prompt").

### 3. `deny` permissions: hidden from the model, or execution-blocked? — **both, depending on rule shape** [official]

- `session/llm/request.ts` `resolveTools()`: `Record.filter(input.tools, (_, k) => input.user.tools?.[k] !== false && !disabled.has(k))` — tools in the `Permission.disabled` set are **removed from the tool list sent to the model entirely**.
- `permission/index.ts` `disabled()`: a tool is disabled only when the **last matching rule has `pattern === "*"` and `action === "deny"`** (with `edit` mapping to edit/write/apply_patch). So a blanket `"edit": "deny"` hides the tools from the model; a granular ruleset like `{"*": "allow", "rm *": "deny"}` keeps the tool visible and blocks matching calls at execution time.
- Corroborated by docs: agents.mdx permission table calls `deny` "Disable the tool"; task subagents under `deny` are "removed from the Task tool description entirely" (agents.mdx "Task permissions").
- Bonus dynamic channel: the same filter honors a per-prompt `user.tools[name] === false` map (SDK `session.prompt` body), letting a driver disable tools per message.

### 4. Suppressing todo/task/title-gen scaffolding — **[official]**

- `todowrite`/`todoread`: `permission: { todowrite: "deny" }` (gates both, agents.mdx table) → removed from the model's tool list per §3. Already denied for subagents by default (tools.mdx).
- `task`: `permission: { task: "deny" }` removes the task tool; per-subagent globs prune the Task description (agents.mdx).
- Title generation: the hidden `title` agent is a normal config-addressable agent. `agent: { title: { disable: true } }` deletes it (`agent/agent.ts`: `if (value.disable) { delete agents[key] }`), and title gen then silently no-ops (`session/prompt.ts` `ensureTitle`: `const ag = yield* agents.get("title"); if (!ag) return`). You can alternatively repoint its `model`/`prompt` via the same config, or steer the small model via `small_model` config (config.mdx "Models") / `experimental.provider.small_model` hook. Same config surface exists for hidden `summary` and `compaction` agents (disabling `compaction` is not recommended — auto-compaction depends on it).
- Prompt-level scaffolding (todo exhortations etc.) lives in the provider prompt files, so a custom agent `prompt` removes it (§2).

### 5. Dynamic / per-model / per-provider / per-session tool availability

- **Per model/provider, built-in** [official mechanism, not configurable]: `tool/registry.ts` gates tools on model/provider id — `apply_patch` only for `gpt-` (non-oss, non-gpt-4) ids with `edit`/`write` excluded in that case; `websearch` only for the opencode provider or exa/parallel flags. Recomputed per message (`SessionTools.resolve` is called each request with `{ modelID, providerID, agent }`), so mid-session model switches re-resolve.
- **Per agent** [official]: agent-level `permission` (deny hides, §3) + per-agent `model` — the supported config trick for "different toolset per model" is one agent per model.
- **Per session/message** [trick]: SDK `session.prompt` `body.tools` map (§3) — works but only for SDK-driven sessions, not TUI typing.
- **Plugin-decided at runtime** [fork-only for visibility, trick for behavior]: there is no plugin hook to add/remove tools from the list per request (plugin `tool:` registrations are static at load; `tool.definition` can mutate description/schema but not remove; `config` hook runs at startup). A plugin *can* make one tool behave differently per model by tracking the active model via `chat.params` (which receives `model` + `provider`) and branching inside `execute`, or throwing in `tool.execute.before`.

### 6. Auth / provider / credential visibility from a plugin

- **Active model + provider per request** [official]: `chat.params` / `chat.headers` input: `{ sessionID, agent, model: Model, provider: ProviderContext, message }` where `ProviderContext = { source: "env"|"config"|"custom"|"api", info: Provider, options: Record<string, any> }` (`plugin/src/index.ts`) — `options` carries provider options (baseURL, apiKey when config-supplied). `chat.headers` can inject/override request headers.
- **Credentials** [official, scoped]: the `auth` hook (`AuthHook`) declares a `provider` and gets `loader: (auth: () => Promise<Auth>, provider) => Promise<Record<string,any>>` — full stored credential (API key or OAuth access/refresh/expires) for that provider, and can define its own oauth/api login methods. The SDK client can set credentials (`client.auth.set`, sdk.mdx "Auth") but has no documented read endpoint.
- **Unscoped read** [trick]: plugins run in-process under Bun with no sandbox; reading `~/.local/share/opencode/auth.json` directly works (ticket 0010 already relies on this for OpenAI creds).
- `client.config.providers()` lists providers + default models (sdk.mdx).

### 7. Output caps on tool results — **[official-ish]** cap exists and is configurable

- `tool/truncate.ts`: defaults `MAX_LINES = 2000`, `MAX_BYTES = 50 * 1024` (50 KB); overridable via config `tool_output.max_lines` / `tool_output.max_bytes` (read as `cfg?.tool_output?.max_lines ?? MAX_LINES`) — present in the config schema but **not documented** in the mdx docs. Truncation keeps head (or tail), appends a hint with removed counts, and writes the full output to a truncation dir (7-day retention) whose path is given to the model.
- Applied centrally in `session/tools.ts` via `truncate.output(...)` to tool results, so it will sit **on top of** Pi's own truncation policy: Pi-replacement tools should either emit output under these limits or v2 should raise `tool_output` limits in the config it installs, then let Pi's policy be the effective truncator.
- Separate cap: image/attachment normalization (`attachment.image`, config.mdx) — resize over 2000x2000 px / 5 MB base64; oversized tool-result images are omitted.

### Verdict for the v2 spec

Everything Pi v2 needs except two items is officially supported: full read/bash/edit/write replacement, blanket-deny to hide built-ins, todo/title/task suppression, per-agent minimal prompt, configurable output caps, and per-request model/provider visibility. The two exceptions: (a) removing the `<env>` header and achieving byte-exact Pi system prompts requires the `experimental.chat.system.transform` hook — works today but is explicitly unstable, so the spec should treat "agent.prompt + tolerate the <env> block" as the fallback; (b) plugin-controlled per-request tool *visibility* doesn't exist — lean on OpenCode's native gpt/apply_patch swap and per-agent permissions instead.
