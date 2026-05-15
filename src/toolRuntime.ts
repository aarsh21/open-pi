import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"
import { homedir } from "node:os"
import { spawn } from "node:child_process"

export function expandPath(path: string) {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return homedir() + path.slice(1)
  return path.startsWith("@") ? path.slice(1) : path
}

export function resolveToCwd(path: string, cwd: string) {
  const expanded = expandPath(path)
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded)
}

export async function readTextFile(path: string, cwd: string) {
  const abs = resolveToCwd(path, cwd)
  await access(abs, constants.R_OK)
  return readFile(abs, "utf8")
}

export async function writeTextFile(path: string, cwd: string, content: string) {
  const abs = resolveToCwd(path, cwd)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, content, "utf8")
}

export async function editTextFile(path: string, cwd: string, edits: Array<{ oldText: string; newText: string }>) {
  const abs = resolveToCwd(path, cwd)
  await access(abs, constants.R_OK | constants.W_OK)
  const original = await readFile(abs, "utf8")
  await writeFile(abs, applyEdits(original, edits), "utf8")
}

export function runShell(command: string, cwd: string, timeout?: number, signal?: AbortSignal) {
  return new Promise<{ code: number | null; output: string }>((resolvePromise, reject) => {
    const child = spawn(process.env.SHELL || "/bin/bash", ["-lc", command], { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" })
    let output = ""
    let timedOut = false
    const kill = () => { if (child.pid) process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGTERM") }
    const timer = timeout && timeout > 0 ? setTimeout(() => { timedOut = true; kill() }, timeout * 1000) : undefined
    const onAbort = () => kill()
    signal?.addEventListener("abort", onAbort, { once: true })
    child.stdout.on("data", (d) => { output += d.toString() })
    child.stderr.on("data", (d) => { output += d.toString() })
    child.on("error", reject)
    child.on("close", (code) => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      if (signal?.aborted) reject(new Error("Command aborted"))
      else if (timedOut) reject(new Error(`Command timed out after ${timeout} seconds\n\n${output}`))
      else resolvePromise({ code, output })
    })
  })
}

export function applyEdits(original: string, edits: Array<{ oldText: string; newText: string }>) {
  const ranges = edits.map((edit, index) => {
    const start = original.indexOf(edit.oldText)
    if (start === -1) throw new Error(`Edit ${index + 1}: oldText not found in file.`)
    const second = original.indexOf(edit.oldText, start + edit.oldText.length)
    if (second !== -1) throw new Error(`Edit ${index + 1}: oldText is not unique in file.`)
    return { ...edit, start, end: start + edit.oldText.length, index }
  }).sort((a, b) => a.start - b.start)
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].start < ranges[i - 1].end) throw new Error(`Edit ${ranges[i].index + 1}: overlaps another edit.`)
  }
  let out = ""; let pos = 0
  for (const r of ranges) { out += original.slice(pos, r.start) + r.newText; pos = r.end }
  return out + original.slice(pos)
}
