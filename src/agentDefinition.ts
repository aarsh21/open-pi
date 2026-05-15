export const PACKAGE_NAME = "@aarsh21/open-pi"

export const AGENT_PROMPT = `You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

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

export function piPermission(enableTodo: boolean) {
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

export function piAgentConfig(enableTodo: boolean) {
  return {
    description: "Pi-style coding agent with read, bash, edit, and write tools",
    mode: "primary",
    prompt: "{file:./agents/pi.md}",
    permission: piPermission(enableTodo),
  }
}

export function piAgentFile(enableTodo: boolean) {
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
