import { describe, expect, it } from "vitest"
import { createInstallationPlan } from "../src/installPlan.js"

const base = { currentConfig: {}, pluginEntry: "@aarsh21/open-pi", configDir: "/cfg" }

describe("createInstallationPlan", () => {
  it("enables the question tool when asked", () => {
    const plan = createInstallationPlan({ ...base, options: { makeDefault: false, enableTodo: false, enableQuestion: true } })
    expect(plan.config.agent.pi.permission.question).toBe("allow")
    expect(plan.agentFile).toContain("question: allow")
  })

  it("denies the question tool by default", () => {
    const plan = createInstallationPlan({ ...base, options: { makeDefault: false, enableTodo: false, enableQuestion: false } })
    expect(plan.config.agent.pi.permission.question).toBe("deny")
  })

  it("does not remove an existing default_agent when declining makeDefault", () => {
    const plan = createInstallationPlan({
      ...base,
      currentConfig: { default_agent: "pi" },
      options: { makeDefault: false, enableTodo: false, enableQuestion: false },
    })
    expect(plan.config.default_agent).toBe("pi")
  })

  it("cleans up legacy MCP entries", () => {
    const plan = createInstallationPlan({
      ...base,
      currentConfig: { mcp: { exa: { type: "remote" }, keep: { type: "remote" } } },
      options: { makeDefault: false, enableTodo: false, enableQuestion: false },
    })
    expect(plan.config.mcp).toEqual({ keep: { type: "remote" } })
  })
})
