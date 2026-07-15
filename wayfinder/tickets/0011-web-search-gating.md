---
id: "0011"
name: Web search gating
type: wayfinder:grilling
status: closed
assignee: aarsh
blocked-by: []
---

## Question

Surfaced by [Web search via OpenAI auth](0010-openai-web-search-tool.md): when is the `web_search` tool available to the pi agent? Decide with the user between: (a) credentials-based — available whenever OpenAI creds exist in `auth.json`, regardless of active model; (b) model-based — only when the active model is OpenAI (awkward: tool-execute context lacks the model id, though `chat.params` sees it); (c) multi-backend — OpenAI when available, alternate search backend otherwise. Also settle the failure UX when the subscription token has expired (unofficial chatgpt.com endpoint returns 401).

## Resolution

Credentials-based (option a): the plugin registers `web_search` only when OpenAI credentials exist (`auth.json` openai entry or `OPENAI_API_KEY`), regardless of active model. Expired-token UX: auth.json is re-read on every call, and a 401/403 returns "OpenAI authentication failed (token may be expired). Re-run /connect for openai in OpenCode or set OPENAI_API_KEY."
