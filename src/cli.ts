#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

const PACKAGE_NAME = "open-pi"
const AGENT_FILE = `---
description: Pi-style coding agent with read, bash, edit, and write tools
mode: primary
permission:
  read: allow
  bash: allow
  edit: allow
---

You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
- read: Read file contents
- bash: Execute bash commands (ls, grep, find, etc.)
- edit: Make surgical edits to files
- write: Create or overwrite files

In addition to the tools above, you may have access to other custom tools depending on the project.

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

function install() {
  const path = configPath()
  const config = readConfig(path)
  const plugins = Array.isArray(config.plugin) ? config.plugin.filter((p: unknown) => p !== PACKAGE_NAME && p !== pluginEntry()) : []
  plugins.push(pluginEntry())
  config.plugin = plugins

  config.agent = config.agent || {}
  config.agent.pi = {
    description: "Pi-style coding agent with read, bash, edit, and write tools",
    mode: "primary",
    prompt: "{file:./agents/pi.md}",
    permission: { read: "allow", bash: "allow", edit: "allow" },
  }

  writeConfig(path, config)

  const agentsDir = join(configDir(), "agents")
  mkdirSync(agentsDir, { recursive: true })
  writeFileSync(join(agentsDir, "pi.md"), AGENT_FILE)

  console.log("open-pi installed")
  console.log(`- Plugin added to ${path}`)
  console.log(`- Pi agent written to ${join(agentsDir, "pi.md")}`)
  console.log("Restart OpenCode and switch to the pi agent.")
}

function help() {
  console.log(`open-pi\n\nUsage:\n  bunx open-pi install\n  npx open-pi install\n\nInstalls the OpenCode plugin and Pi agent into your OpenCode config directory.`)
}

const cmd = process.argv[2] || "install"
if (cmd === "install") install()
else if (cmd === "-h" || cmd === "--help" || cmd === "help") help()
else { console.error(`Unknown command: ${cmd}`); process.exit(1) }
