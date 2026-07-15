import { describe, expect, it } from "vitest"
import { decodeJwt, extractSearchOutput, formatSearchMarkdown, parseResponsesSSE } from "../src/webSearch.js"

function makeJwt(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `header.${body}.signature`
}

describe("decodeJwt", () => {
  it("detects Codex JWTs by the openai auth claim", () => {
    const token = makeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acc-123" } })
    expect(decodeJwt(token)).toEqual({ isCodex: true, accountId: "acc-123" })
  })

  it("treats plain API keys and other JWTs as non-Codex", () => {
    expect(decodeJwt("sk-plain-api-key").isCodex).toBe(false)
    expect(decodeJwt(makeJwt({ sub: "user" })).isCodex).toBe(false)
  })
})

describe("SSE parsing and extraction", () => {
  const sse = [
    `data: ${JSON.stringify({
      type: "response.output_item.done",
      item: {
        id: "ws-1",
        type: "web_search_call",
        action: { sources: [{ url: "https://example.com/a?utm_source=openai", title: "Example A" }] },
      },
    })}`,
    `data: ${JSON.stringify({
      type: "response.output_item.done",
      item: {
        id: "msg-1",
        type: "message",
        content: [
          {
            type: "output_text",
            text: "The answer is 42.",
            annotations: [{ type: "url_citation", url: "https://example.com/b", title: "Example B" }],
          },
        ],
      },
    })}`,
    "data: [DONE]",
  ].join("\n\n")

  it("collects completed output items and extracts answer plus deduped sources", () => {
    const items = parseResponsesSSE(sse)
    expect(items).toHaveLength(2)

    const { answer, results } = extractSearchOutput(items, 5)
    expect(answer).toBe("The answer is 42.")
    expect(results).toEqual([
      { title: "Example A", url: "https://example.com/a" },
      { title: "Example B", url: "https://example.com/b" },
    ])
  })

  it("strips utm_source=openai without corrupting longer values", () => {
    const items = [
      {
        type: "web_search_call",
        action: {
          sources: [
            { url: "https://example.com/a?utm_source=openai&x=1", title: "A" },
            { url: "https://example.com/b?utm_source=openai-blog", title: "B" },
          ],
        },
      },
    ]
    const { results } = extractSearchOutput(items, 5)
    expect(results[0].url).toBe("https://example.com/a?x=1")
    expect(results[1].url).toBe("https://example.com/b?utm_source=openai-blog")
  })

  it("renders markdown with numbered sources", () => {
    const text = formatSearchMarkdown("Answer.", [{ title: "T", url: "https://x.dev" }])
    expect(text).toBe("Answer.\n\nSources:\n1. T — https://x.dev")
  })
})
