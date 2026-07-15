---
id: "0010"
name: Web search via OpenAI auth
type: wayfinder:research
status: closed
assignee: research-agent
blocked-by: []
---

## Question

User directive: v2 adds a web-search tool that, when an OpenAI model/subscription is in use, performs search through OpenAI (the way https://github.com/nicobailon/pi-web-access does for Pi). Research what the spec needs:

- Read the pi-web-access extension (fetch/clone the repo): how it implements web search, how it detects and reuses the OpenAI subscription/auth inside Pi, what its tool schema and output look like.
- How OpenAI's web search is invoked (Responses API web_search tool? which endpoint/auth), and what an OpenCode plugin can reach of the user's OpenAI credentials (auth storage, provider config, models.mdx/providers docs in `openocode-docs/`).
- Behavior when the active model is not OpenAI: no web search? alternate backend? (Flag as an open decision for the spec if the answer isn't forced.)

Output: a design sketch for the web-search tool (schema, auth path, gating) ready to fold into the v2 spec.

## Resolution

### How pi-web-access does it (repo read in full; key file `openai-search.ts`)

pi-web-access registers one `web_search` tool with a provider chain (OpenAI → Exa → Brave → Parallel → Tavily → Perplexity → Gemini). The OpenAI provider:

- **Auth resolution order**: (1) Pi's model registry — `ctx.modelRegistry.getApiKeyAndHeaders(model)` tried against candidate models for provider `openai-codex` (Codex/ChatGPT subscription) then `openai`; (2) `OPENAI_API_KEY` env; (3) `openaiApiKey` in `~/.pi/web-search.json`. So it *reuses whatever token Pi already holds* rather than doing its own OAuth.
- **Two endpoints, picked by token shape**: if the bearer is a Codex JWT (payload contains the `https://api.openai.com/auth` claim), it POSTs to `https://chatgpt.com/backend-api/codex/responses` with extra headers `chatgpt-account-id: <chatgpt_account_id from JWT>` and `originator: pi`; otherwise plain API key against `https://api.openai.com/v1/responses`. Both send `OpenAI-Beta: responses=experimental`.
- **Request body**: `{ model, instructions, input: [{role:"user", content:[{type:"input_text", text: query}]}], tools: [{ type: "web_search", filters: { allowed_domains?, blocked_domains? } }], include: ["web_search_call.action.sources"], store: false, stream: true, tool_choice: "required", parallel_tool_calls: true }`. Recency and result-count preferences are expressed in the `instructions` string, not API params. 60s timeout.
- **Output parsing**: consumes the SSE stream (`response.output_item.done` / `response.completed`), then extracts (a) answer text from `message` items, (b) results from `url_citation` annotations (title, url, ±100-char snippet around the citation span) plus `web_search_call.action.sources`, deduped, `utm_source=openai` stripped, capped at 20. Provider output shape: `{ answer: string, results: [{title, url, snippet}] }`.
- **Tool schema (user-facing)**: `query` / `queries[]`, `numResults` (default 5, max 20), `recencyFilter` (`day|week|month|year`), `domainFilter` (`-` prefix excludes), `provider`, `includeContent`, `workflow`. Availability is soft: if no OpenAI auth resolves, it falls through to the next provider; forcing `provider: "openai"` without auth errors with login/key guidance.

### OpenAI web_search programmatically

Official surface: Responses API `POST /v1/responses` with `tools: [{ type: "web_search" }]` (`web_search_preview` is the legacy variant). Supported params: `filters.allowed_domains`/`blocked_domains` (≤100), `user_location`, `search_context_size` (`low|medium|high`). Output = `web_search_call` items + `message` items carrying `url_citation` annotations and a `sources` list. Officially this requires an **API key** and bills per tool call. ChatGPT-subscription (Codex OAuth) access is **not an official API**: it works only via the `chatgpt.com/backend-api/codex/responses` endpoint with the Codex JWT + `chatgpt-account-id` header, i.e. the same unofficial-but-stable path Codex CLI and pi-web-access use. Subscription tokens do **not** work against `api.openai.com`.

### What an OpenCode plugin can reach (openocode-docs/)

- Credentials from `/connect` live in `~/.local/share/opencode/auth.json` (providers.mdx “Credentials”). For OpenAI, `/connect` offers **ChatGPT Plus/Pro OAuth** or **manual API key**, so the file holds either an OAuth record (access/refresh JWT — the Codex-style token) or `{type:"api", key}`.
- Plugins run in Bun with full fs access and `$` shell (plugins.mdx), so reading `auth.json` directly is possible and is the realistic auth path. The SDK client exposes `auth.set()` only — no documented read API (sdk.mdx).
- `client.config.providers()` lists connected providers + default models; `client.config.get()` gives the configured `model` (sdk.mdx) — enough to gate on "is OpenAI connected / default".
- Custom tool execute context is `{ agent, sessionID, messageID, directory, worktree }` (custom-tools.mdx) — **no model id**. The active model for the running session must be inferred (e.g. `client.session.messages()` → last assistant message's provider/model, or config default). No documented `chat.params`-style hook in these docs.

### Design sketch for v2

**Tool** (registered via plugin `tool` hook, name `web_search`):

```ts
web_search({
  query: string,                      // required
  numResults?: number,                // default 5, max 20
  recencyFilter?: "day"|"week"|"month"|"year",
  domainFilter?: string[],            // "-" prefix excludes; maps to filters.allowed/blocked_domains
})
```

Returns markdown: synthesized answer followed by a numbered source list (`title — url`), from `{ answer, results[] }` parsed exactly as pi-web-access does (message text + url_citation annotations + web_search_call sources).

**Auth path** (mirror pi-web-access order, adapted to OpenCode):
1. Read `~/.local/share/opencode/auth.json` → `openai` entry. OAuth record → use access token; JWT with the `https://api.openai.com/auth` claim → Codex endpoint (`chatgpt.com/backend-api/codex/responses`, headers `chatgpt-account-id` from JWT, `originator`, `OpenAI-Beta: responses=experimental`). `type:"api"` → `api.openai.com/v1/responses`.
2. Fallback: `OPENAI_API_KEY` env.
3. Caveat to spec: OAuth access tokens expire; auth.json holds a refresh token but the plugin has no documented refresh API — either re-read auth.json per call (OpenCode refreshes it when the model is used) and surface a "re-run /connect" error on 401, or implement the token refresh flow ourselves. Spec should pick the cheap option first (re-read + friendly 401 error).

**Request/parse**: same body and SSE parsing as pi-web-access (`tool_choice:"required"`, `store:false`, `include:["web_search_call.action.sources"]`, instructions carry recency/result-count hints, filters carry domains). Model id: a small fixed candidate list (current codex/gpt models), not the session's model.

**Gating**: register the tool at plugin init only when an `openai` entry exists in auth.json (or `OPENAI_API_KEY` set); otherwise skip registration so the agent never sees a dead tool. Availability is about *credentials existing*, not about the active session model — the search request is its own API call and works regardless of which model is chatting.

### Open decision (flagged, not decided)

**Behavior when the active model is not OpenAI.** Options: (a) tool only exists when OpenAI creds are connected, regardless of active model (recommended default — creds, not model, are what the search actually needs); (b) stricter: hide/disable the tool unless the active session model is an OpenAI one (requires the awkward active-model inference noted above); (c) pi-web-access-style fallback chain to other backends (Exa/Brave/etc.) when OpenAI is absent — more capability, more scope. The user directive ties the tool to "OpenAI model/subscription in use", which reads closest to (a) or (b); the spec must pick one and say what happens with zero backends (no tool vs error text).
