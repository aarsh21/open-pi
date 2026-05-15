#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { createInterface } from "node:readline/promises"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

const PACKAGE_NAME = "@aarsh21/open-pi"
const AGENT_PROMPT = `You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
- read: Read file contents
- bash: Execute bash commands (ls, grep, find, etc.)
- edit: Make surgical edits to files
- write: Create or overwrite files

Guidelines:
- Use bash for file operations like ls, rg, find
- Use read to examine files instead of cat or sed.
- When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls
- Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.
- Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.
- Use write only for new files or complete rewrites.
- Be concise in your responses
- Show file paths clearly when working with files
`

type OpenCodeConfig = Record<string, any>

function configDir() {
  return process.env.OPENCODE_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode")
}

function configPath() {
  const dir = configDir()
  const json = join(dir, "opencode.json")
  const jsonc = join(dir, "opencode.jsonc")
  return existsSync(jsonc) && !existsSync(json) ? jsonc : json
}

function stripJsonComments(json: string) {
  return json
    .replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, c) => c ? "" : m)
    .replace(/\\"|"(?:\\"|[^"])*"|(,)(\s*[}\]])/g, (m, c, close) => c ? close : m)
}

function readConfig(path: string): OpenCodeConfig {
  if (!existsSync(path)) return {}
  const text = readFileSync(path, "utf8")
  if (!text.trim()) return {}
  return JSON.parse(stripJsonComments(text))
}

function writeConfig(path: string, config: OpenCodeConfig) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`)
  renameSync(tmp, path)
}

function findPackageRoot(start = process.argv[1]) {
  let current = dirname(start || process.cwd())
  while (true) {
    const pkg = join(current, "package.json")
    if (existsSync(pkg)) {
      try {
        if (JSON.parse(readFileSync(pkg, "utf8")).name === PACKAGE_NAME) return current
      } catch {}
    }
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function pluginEntry() {
  const root = findPackageRoot()
  if (!root || root.includes(`/node_modules/${PACKAGE_NAME}`)) return PACKAGE_NAME
  return root
}

async function confirm(message: string, defaultYes = false) {
  if (!process.stdin.isTTY || process.argv.includes("--yes") || process.argv.includes("-y")) return defaultYes
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const suffix = defaultYes ? " (Y/n) " : " (y/N) "
    const answer = (await rl.question(`${message}${suffix}`)).trim().toLowerCase()
    if (!answer) return defaultYes
    return answer === "y" || answer === "yes"
  } finally {
    rl.close()
  }
}

function configureMcp(config: OpenCodeConfig, enableExa: boolean) {
  if (!config.mcp || typeof config.mcp !== "object") config.mcp = {}
  delete config.mcp.context7
  if (enableExa) {
    config.mcp.exa = {
      type: "remote",
      url: "https://mcp.exa.ai/mcp",
      enabled: true,
    }
  } else {
    delete config.mcp.exa
  }
  if (Object.keys(config.mcp).length === 0) delete config.mcp
}

function piPermission(enableTodo: boolean) {
  return {
    read: "allow",
    bash: "allow",
    edit: "allow",
    glob: "deny",
    grep: "deny",
    list: "deny",
    task: "deny",
    todowrite: enableTodo ? "allow" : "deny",
    webfetch: "deny",
    websearch: "deny",
    lsp: "deny",
    skill: "deny",
    question: "deny",
  }
}

function agentFile(enableTodo: boolean) {
  const todoPermission = enableTodo ? "allow" : "deny"
  return `---
description: Pi-style coding agent with read, bash, edit, and write tools
mode: primary
permission:
  read: allow
  bash: allow
  edit: allow
  glob: deny
  grep: deny
  list: deny
  task: deny
  todowrite: ${todoPermission}
  webfetch: deny
  websearch: deny
  lsp: deny
  skill: deny
  question: deny
---

${AGENT_PROMPT}`
}

async function install() {
  const path = configPath()
  const config = readConfig(path)
  const plugins = Array.isArray(config.plugin) ? config.plugin.filter((p: unknown) => p !== PACKAGE_NAME && p !== pluginEntry()) : []
  plugins.push(pluginEntry())
  const makeDefault = await confirm("Make pi your default OpenCode agent?", false)
  const enableExa = await confirm("Enable Exa MCP web search?", false)
  const enableTodo = await confirm("Enable OpenCode todo tool for pi agent?", false)

  config.plugin = plugins
  configureMcp(config, enableExa)

  config.agent = config.agent || {}
  config.agent.pi = {
    description: "Pi-style coding agent with read, bash, edit, and write tools",
    mode: "primary",
    prompt: "{file:./agents/pi.md}",
    permission: piPermission(enableTodo),
  }

  if (makeDefault) {
    config.default_agent = "pi"
  }

  writeConfig(path, config)

  const agentsDir = join(configDir(), "agents")
  mkdirSync(agentsDir, { recursive: true })
  writeFileSync(join(agentsDir, "pi.md"), agentFile(enableTodo))

  console.log("open-pi installed")
  console.log(`- Plugin added to ${path}`)
  console.log(`- Pi agent written to ${join(agentsDir, "pi.md")}`)
  console.log("Restart OpenCode and switch to the pi agent.")
}

function help() {
  console.log(`open-pi\n\nUsage:\n  bunx @aarsh21/open-pi install\n  npx @aarsh21/open-pi install\n\nInstalls the OpenCode plugin and Pi agent into your OpenCode config directory.`)
}

const cmd = process.argv[2] || "install"
if (cmd === "install") install().catch((err) => { console.error(err); process.exit(1) })
else if (cmd === "-h" || cmd === "--help" || cmd === "help") help()
else { console.error(`Unknown command: ${cmd}`); process.exit(1) }
