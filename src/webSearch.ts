// OpenAI-backed web search, modeled on the pi-web-access extension
// (github.com/nicobailon/pi-web-access). Reuses the credentials OpenCode
// already stores for the openai provider: a ChatGPT-subscription OAuth token
// (Codex JWT) goes to the chatgpt.com codex endpoint, a plain API key goes to
// the official Responses API.

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export interface OpenAIAuth {
  kind: "oauth" | "api"
  token: string
}

export interface WebSearchArgs {
  query: string
  numResults?: number
  recencyFilter?: "day" | "week" | "month" | "year"
  domainFilter?: string[]
}

interface SearchResult {
  title: string
  url: string
  snippet?: string
}

export function authJsonPath(): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
  return join(dataHome, "opencode", "auth.json")
}

// Re-read auth.json on every call: OpenCode refreshes the OAuth token when the
// openai provider is used, so the file is the freshest source we have.
export async function resolveOpenAIAuth(): Promise<OpenAIAuth | null> {
  try {
    const raw = await readFile(authJsonPath(), "utf8")
    const parsed = JSON.parse(raw) as Record<string, any>
    const entry = parsed.openai
    if (entry) {
      if (entry.type === "oauth" && typeof entry.access === "string") return { kind: "oauth", token: entry.access }
      if (entry.type === "api" && typeof entry.key === "string") return { kind: "api", token: entry.key }
    }
  } catch {}
  if (process.env.OPENAI_API_KEY) return { kind: "api", token: process.env.OPENAI_API_KEY }
  return null
}

interface JwtInfo {
  isCodex: boolean
  accountId?: string
}

export function decodeJwt(token: string): JwtInfo {
  const parts = token.split(".")
  if (parts.length !== 3) return { isCodex: false }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
    const authClaim = payload["https://api.openai.com/auth"]
    if (authClaim && typeof authClaim === "object") {
      return { isCodex: true, accountId: authClaim.chatgpt_account_id }
    }
    return { isCodex: false }
  } catch {
    return { isCodex: false }
  }
}

function buildInstructions(args: WebSearchArgs): string {
  const numResults = Math.min(Math.max(args.numResults ?? 5, 1), 20)
  let instructions = `Search the web for the user's query and answer concisely. Cite up to ${numResults} of the most relevant sources.`
  if (args.recencyFilter) instructions += ` Prefer results from the past ${args.recencyFilter}.`
  return instructions
}

function buildDomainFilters(domainFilter?: string[]): { allowed_domains?: string[]; blocked_domains?: string[] } | undefined {
  if (!domainFilter || domainFilter.length === 0) return undefined
  const allowed = domainFilter.filter((d) => !d.startsWith("-"))
  const blocked = domainFilter.filter((d) => d.startsWith("-")).map((d) => d.slice(1))
  const filters: { allowed_domains?: string[]; blocked_domains?: string[] } = {}
  if (allowed.length > 0) filters.allowed_domains = allowed
  if (blocked.length > 0) filters.blocked_domains = blocked
  return Object.keys(filters).length > 0 ? filters : undefined
}

// Parse the SSE stream from the Responses API into completed output items.
export function parseResponsesSSE(sseText: string): any[] {
  const items: any[] = []
  for (const rawLine of sseText.split("\n")) {
    const line = rawLine.trim()
    if (!line.startsWith("data:")) continue
    const data = line.slice(5).trim()
    if (!data || data === "[DONE]") continue
    try {
      const event = JSON.parse(data)
      if (event.type === "response.output_item.done" && event.item) {
        items.push(event.item)
      } else if (event.type === "response.completed" && Array.isArray(event.response?.output)) {
        for (const item of event.response.output) {
          if (!items.some((existing) => existing.id && existing.id === item.id)) items.push(item)
        }
      }
    } catch {}
  }
  return items
}

export function extractSearchOutput(items: any[], maxResults: number): { answer: string; results: SearchResult[] } {
  const answerParts: string[] = []
  const results: SearchResult[] = []
  const seen = new Set<string>()

  const stripUtmSource = (url: string): string => {
    try {
      const parsed = new URL(url)
      if (parsed.searchParams.get("utm_source") === "openai") {
        parsed.searchParams.delete("utm_source")
      }
      return parsed.toString()
    } catch {
      return url
    }
  }

  const addResult = (result: SearchResult) => {
    const url = stripUtmSource(result.url)
    if (seen.has(url) || results.length >= maxResults) return
    seen.add(url)
    results.push({ ...result, url })
  }

  for (const item of items) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const content of item.content) {
        if (typeof content.text === "string") {
          answerParts.push(content.text)
          for (const annotation of content.annotations ?? []) {
            if (annotation.type === "url_citation" && typeof annotation.url === "string") {
              addResult({ title: annotation.title ?? annotation.url, url: annotation.url })
            }
          }
        }
      }
    }
    if (item.type === "web_search_call" && Array.isArray(item.action?.sources)) {
      for (const source of item.action.sources) {
        if (typeof source.url === "string") addResult({ title: source.title ?? source.url, url: source.url })
      }
    }
  }

  return { answer: answerParts.join("\n").trim(), results }
}

export function formatSearchMarkdown(answer: string, results: SearchResult[]): string {
  let text = answer || "(no answer)"
  if (results.length > 0) {
    text += "\n\nSources:\n"
    text += results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}`).join("\n")
  }
  return text
}

export async function openAIWebSearch(
  args: WebSearchArgs,
  signal?: AbortSignal,
  discoveredModels?: string[],
): Promise<string> {
  if (signal?.aborted) throw new Error("Web search aborted")
  const auth = await resolveOpenAIAuth()
  if (!auth) {
    throw new Error("No OpenAI credentials found. Run /connect for openai in OpenCode or set OPENAI_API_KEY.")
  }

  const jwt = auth.kind === "oauth" ? decodeJwt(auth.token) : { isCodex: false }
  const useCodexEndpoint = auth.kind === "oauth" && jwt.isCodex

  const url = useCodexEndpoint ? "https://chatgpt.com/backend-api/codex/responses" : "https://api.openai.com/v1/responses"
  // Model ids the user's OpenCode actually offers come first (discovered from
  // the openai provider at plugin init); static fallbacks after. Any model the
  // endpoint rejects as unsupported is skipped, so whichever model the auth
  // token serves ends up working.
  const fallbacks = useCodexEndpoint
    ? ["gpt-5.4-mini", "gpt-5.4", "gpt-5.5", "gpt-5.3-codex-spark"]
    : ["gpt-5-mini", "gpt-5.4-mini"]
  const candidates = process.env.OPENPI_WEBSEARCH_MODEL
    ? [process.env.OPENPI_WEBSEARCH_MODEL]
    : [...new Set([...(discoveredModels ?? []), ...fallbacks])].slice(0, 8)

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "OpenAI-Beta": "responses=experimental",
  }
  if (useCodexEndpoint) {
    if (jwt.accountId) headers["chatgpt-account-id"] = jwt.accountId
    headers.originator = "open-pi"
  }

  const domainFilters = buildDomainFilters(args.domainFilter)
  const requestBody = (model: string): Record<string, unknown> => ({
    model,
    instructions: buildInstructions(args),
    input: [{ role: "user", content: [{ type: "input_text", text: args.query }] }],
    tools: [{ type: "web_search", ...(domainFilters ? { filters: domainFilters } : {}) }],
    include: ["web_search_call.action.sources"],
    store: false,
    stream: true,
    tool_choice: "required",
  })

  let lastModelError: string | undefined
  for (const model of candidates) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60_000)
    const onExternalAbort = () => controller.abort()
    signal?.addEventListener("abort", onExternalAbort, { once: true })

    try {
      let response: Response
      try {
        response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody(model)),
          signal: controller.signal,
        })
      } catch (err) {
        if (signal?.aborted) throw new Error("Web search aborted")
        if (controller.signal.aborted) throw new Error("Web search timed out after 60 seconds")
        throw err
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error(
          "OpenAI authentication failed (token may be expired). Re-run /connect for openai in OpenCode or set OPENAI_API_KEY.",
        )
      }
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 500)
        if ((response.status === 400 || response.status === 404) && /not supported|does not exist|unknown model/i.test(detail)) {
          lastModelError = `OpenAI web search failed with status ${response.status}: ${detail}`
          continue
        }
        throw new Error(`OpenAI web search failed with status ${response.status}${detail ? `: ${detail}` : ""}`)
      }

      const sseText = await response.text()
      const items = parseResponsesSSE(sseText)
      const maxResults = Math.min(Math.max(args.numResults ?? 5, 1), 20)
      const { answer, results } = extractSearchOutput(items, maxResults)
      return formatSearchMarkdown(answer, results)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onExternalAbort)
    }
  }

  throw new Error(
    `${lastModelError ?? "OpenAI web search failed: no usable model."} Set OPENPI_WEBSEARCH_MODEL to a model your account supports.`,
  )
}

export async function hasOpenAICredentials(): Promise<boolean> {
  return (await resolveOpenAIAuth()) !== null
}
