// Lean port of pi's bash execution (pi/packages/coding-agent/src/core/tools/bash.ts
// and src/utils/shell.ts, MIT). Always real bash (never $SHELL), detached process
// group, SIGKILL tree kill, streaming UTF-8 decode with bounded memory. Output
// truncation is left to OpenCode's built-in tool-output cap.

import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { access } from "node:fs/promises"
import { constants } from "node:fs"

const MAX_TIMEOUT_MS = 2_147_483_647
const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1000
// Bound in-memory output; OpenCode truncates to 50KB before the model sees it.
const MAX_BUFFERED_BYTES = 512 * 1024
const EXIT_STDIO_GRACE_MS = 100

export interface ShellConfig {
  shell: string
  args: string[]
}

function findBashOnPath(): string | null {
  const probe = process.platform === "win32" ? ["where", "bash.exe"] : ["which", "bash"]
  try {
    const result = spawnSync(probe[0], [probe[1]], { encoding: "utf-8", timeout: 5000, windowsHide: true })
    if (result.status === 0 && result.stdout) {
      const firstMatch = result.stdout.trim().split(/\r?\n/)[0]
      if (firstMatch && (process.platform !== "win32" || existsSync(firstMatch))) return firstMatch
    }
  } catch {}
  return null
}

export function getShellConfig(): ShellConfig {
  if (process.platform === "win32") {
    const paths: string[] = []
    if (process.env.ProgramFiles) paths.push(`${process.env.ProgramFiles}\\Git\\bin\\bash.exe`)
    if (process.env["ProgramFiles(x86)"]) paths.push(`${process.env["ProgramFiles(x86)"]}\\Git\\bin\\bash.exe`)
    for (const path of paths) {
      if (existsSync(path)) return { shell: path, args: ["-c"] }
    }
    const bashOnPath = findBashOnPath()
    if (bashOnPath) return { shell: bashOnPath, args: ["-c"] }
    throw new Error(
      `No bash shell found. Options:\n` +
        `  1. Install Git for Windows: https://git-scm.com/download/win\n` +
        `  2. Add your bash to PATH (Cygwin, MSYS2, etc.)\n\n` +
        `Searched Git Bash in:\n${paths.map((p) => `  ${p}`).join("\n")}`,
    )
  }

  if (existsSync("/bin/bash")) return { shell: "/bin/bash", args: ["-c"] }
  const bashOnPath = findBashOnPath()
  if (bashOnPath) return { shell: bashOnPath, args: ["-c"] }
  return { shell: "sh", args: ["-c"] }
}

export function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore", detached: true, windowsHide: true })
    } catch {}
  } else {
    try {
      process.kill(-pid, "SIGKILL")
    } catch {
      try {
        process.kill(pid, "SIGKILL")
      } catch {}
    }
  }
}

function resolveTimeoutMs(timeout: number | undefined): number | undefined {
  if (timeout === undefined) return undefined
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("Invalid timeout: must be a finite number of seconds")
  }
  const timeoutMs = timeout * 1000
  if (timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`)
  }
  return timeoutMs
}

// Keep only the tail once the buffer exceeds the cap, cutting on a UTF-8
// character boundary.
function trimToTail(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf-8")
  if (buf.length <= maxBytes) return text
  let start = buf.length - maxBytes
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++
  return buf.subarray(start).toString("utf-8")
}

export async function runShell(
  command: string,
  cwd: string,
  options: { timeout?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const { timeout, signal } = options
  const timeoutMs = resolveTimeoutMs(timeout)
  if (signal?.aborted) throw new Error("Command aborted")

  const shellConfig = getShellConfig()
  try {
    await access(cwd, constants.F_OK)
  } catch {
    throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`)
  }

  const child = spawn(shellConfig.shell, [...shellConfig.args, command], {
    cwd,
    detached: process.platform !== "win32",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })

  const decoder = new TextDecoder()
  let output = ""
  let timedOut = false
  let timeoutHandle: NodeJS.Timeout | undefined
  const onAbort = () => {
    if (child.pid) killProcessTree(child.pid)
  }

  const appendChunk = (data: Buffer) => {
    output += decoder.decode(data, { stream: true })
    if (output.length > MAX_BUFFERED_BYTES * 2) {
      output = trimToTail(output, MAX_BUFFERED_BYTES)
    }
  }

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    let settled = false
    let exited = false
    let code: number | null = null
    let postExitTimer: NodeJS.Timeout | undefined

    const finalize = (finalCode: number | null) => {
      if (settled) return
      settled = true
      if (postExitTimer) clearTimeout(postExitTimer)
      child.stdout?.destroy()
      child.stderr?.destroy()
      resolve(finalCode)
    }

    // After exit, wait for the pipes to fall idle: detached descendants may
    // still be writing through the inherited handles.
    const armIdleTimer = () => {
      if (postExitTimer) clearTimeout(postExitTimer)
      postExitTimer = setTimeout(() => finalize(code), EXIT_STDIO_GRACE_MS)
    }

    const onData = (data: Buffer) => {
      appendChunk(data)
      if (exited && !settled) armIdleTimer()
    }

    child.stdout.on("data", onData)
    child.stderr.on("data", onData)
    child.once("error", (err) => {
      if (settled) return
      settled = true
      if (postExitTimer) clearTimeout(postExitTimer)
      reject(err)
    })
    child.once("exit", (exitedCode) => {
      exited = true
      code = exitedCode
      armIdleTimer()
    })
    child.once("close", (closedCode) => finalize(closedCode))

    if (timeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => {
        timedOut = true
        if (child.pid) killProcessTree(child.pid)
      }, timeoutMs)
    }
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener("abort", onAbort, { once: true })
    }
  }).finally(() => {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    if (signal) signal.removeEventListener("abort", onAbort)
  })

  output += decoder.decode()

  const appendStatus = (text: string, status: string) => `${text ? `${text}\n\n` : ""}${status}`
  if (signal?.aborted) throw new Error(appendStatus(output, "Command aborted"))
  if (timedOut) throw new Error(appendStatus(output, `Command timed out after ${timeout} seconds`))
  if (exitCode !== 0 && exitCode !== null) {
    throw new Error(appendStatus(output || "(no output)", `Command exited with code ${exitCode}`))
  }
  return output || "(no output)"
}
