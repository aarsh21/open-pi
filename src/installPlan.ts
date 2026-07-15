import { join } from "node:path"
import { PACKAGE_NAME, piAgentConfig, piAgentFile } from "./agentDefinition.js"
import type { OpenCodeConfig } from "./jsonConfig.js"

export type InstallOptions = {
  makeDefault: boolean
  enableTodo: boolean
}

export type InstallationPlan = {
  config: OpenCodeConfig
  agentPath: string
  agentFile: string
}

// Older open-pi installers added these MCP entries; clean them up on reinstall.
function removeLegacyMcpEntries(config: OpenCodeConfig) {
  if (!config.mcp || typeof config.mcp !== "object") return
  delete config.mcp.context7
  delete config.mcp.exa
  if (Object.keys(config.mcp).length === 0) delete config.mcp
}

export function createInstallationPlan(args: { currentConfig: OpenCodeConfig; pluginEntry: string; configDir: string; options: InstallOptions }): InstallationPlan {
  const config: OpenCodeConfig = JSON.parse(JSON.stringify(args.currentConfig))
  const plugins = Array.isArray(config.plugin)
    ? config.plugin.filter((p: unknown) => p !== PACKAGE_NAME && p !== args.pluginEntry)
    : []
  plugins.push(args.pluginEntry)

  config.plugin = plugins
  removeLegacyMcpEntries(config)

  config.agent = config.agent || {}
  config.agent.pi = piAgentConfig(args.options.enableTodo)

  // Only ever set the default; answering "no" on a reinstall must not undo an
  // existing default_agent choice.
  if (args.options.makeDefault) {
    config.default_agent = "pi"
  }

  return {
    config,
    agentPath: join(args.configDir, "agents", "pi.md"),
    agentFile: piAgentFile(args.options.enableTodo),
  }
}
