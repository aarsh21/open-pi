#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { createInterface } from "node:readline/promises"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { PACKAGE_NAME } from "./agentDefinition.js"
import { createInstallationPlan } from "./installPlan.js"
import { parseOpenCodeConfig, serializeOpenCodeConfig, type OpenCodeConfig } from "./jsonConfig.js"

function configDir() {
  return process.env.OPENCODE_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode")
}

function configPath() {
  const dir = configDir()
  const json = join(dir, "opencode.json")
  const jsonc = join(dir, "opencode.jsonc")
  return existsSync(jsonc) && !existsSync(json) ? jsonc : json
}

function readConfig(path: string): OpenCodeConfig {
  if (!existsSync(path)) return {}
  return parseOpenCodeConfig(readFileSync(path, "utf8"))
}

function writeConfig(path: string, config: OpenCodeConfig) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, serializeOpenCodeConfig(config))
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

async function confirm(rl: ReturnType<typeof createInterface> | null, message: string, defaultYes = false) {
  if (!rl || !process.stdin.isTTY || process.argv.includes("--yes") || process.argv.includes("-y")) return defaultYes
  const suffix = defaultYes ? " (Y/n) " : " (y/N) "
  const answer = (await rl.question(`${message}${suffix}`)).trim().toLowerCase()
  if (!answer) return defaultYes
  return answer === "y" || answer === "yes"
}

async function install() {
  const path = configPath()
  const currentConfig = readConfig(path)
  const rl = process.stdin.isTTY && !process.argv.includes("--yes") && !process.argv.includes("-y")
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null
  let makeDefault = false
  let enableTodo = false
  let enableQuestion = false
  try {
    makeDefault = await confirm(rl, "Make pi your default OpenCode agent?", false)
    enableTodo = await confirm(rl, "Enable OpenCode todo tool for pi agent?", false)
    enableQuestion = await confirm(rl, "Enable ask-user question tool for pi agent (agent can ask you multiple-choice questions)?", false)
  } finally {
    rl?.close()
  }

  const plan = createInstallationPlan({
    currentConfig,
    pluginEntry: pluginEntry(),
    configDir: configDir(),
    options: { makeDefault, enableTodo, enableQuestion },
  })

  writeConfig(path, plan.config)
  mkdirSync(dirname(plan.agentPath), { recursive: true })
  writeFileSync(plan.agentPath, plan.agentFile)

  console.log("open-pi installed")
  console.log(`- Plugin added to ${path}`)
  console.log(`- Pi agent written to ${plan.agentPath}`)
  console.log("Restart OpenCode and switch to the pi agent.")
}

function help() {
  console.log(`open-pi\n\nUsage:\n  bunx @aarsh21/open-pi install\n  npx @aarsh21/open-pi install\n\nInstalls the OpenCode plugin and Pi agent into your OpenCode config directory.`)
}

const cmd = process.argv[2] || "install"
if (cmd === "install") install().catch((err) => { console.error(err); process.exit(1) })
else if (cmd === "-h" || cmd === "--help" || cmd === "help") help()
else { console.error(`Unknown command: ${cmd}`); process.exit(1) }
