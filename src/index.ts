import { type Plugin, tool } from "@opencode-ai/plugin"
import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"
import { homedir, tmpdir } from "node:os"
import { spawn } from "node:child_process"

const DEFAULT_MAX_LINES = 2000
const DEFAULT_MAX_BYTES = 50 * 1024

function expandPath(path: string) {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return homedir() + path.slice(1)
  return path.startsWith("@") ? path.slice(1) : path
}

function resolveToCwd(path: string, cwd: string) {
  const expanded = expandPath(path)
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded)
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function truncateHead(content: string, maxLines = DEFAULT_MAX_LINES, maxBytes = DEFAULT_MAX_BYTES) {
  const lines = content.split("\n")
  const totalBytes = Buffer.byteLength(content, "utf8")
  if (lines.length <= maxLines && totalBytes <= maxBytes) return { content, truncated: false, totalLines: lines.length, outputLines: lines.length, truncatedBy: null as null | "lines" | "bytes" }
  if (Buffer.byteLength(lines[0] ?? "", "utf8") > maxBytes) return { content: "", truncated: true, totalLines: lines.length, outputLines: 0, truncatedBy: "bytes" as const, firstLineExceedsLimit: true }
  const out: string[] = []
  let bytes = 0
  let truncatedBy: "lines" | "bytes" = "lines"
  for (let i = 0; i < lines.length && i < maxLines; i++) {
    const add = Buffer.byteLength(lines[i], "utf8") + (i > 0 ? 1 : 0)
    if (bytes + add > maxBytes) { truncatedBy = "bytes"; break }
    out.push(lines[i]); bytes += add
  }
  return { content: out.join("\n"), truncated: true, totalLines: lines.length, outputLines: out.length, truncatedBy }
}

function truncateTail(content: string, maxLines = DEFAULT_MAX_LINES, maxBytes = DEFAULT_MAX_BYTES) {
  const lines = content.split("\n")
  const totalBytes = Buffer.byteLength(content, "utf8")
  if (lines.length <= maxLines && totalBytes <= maxBytes) return { content, truncated: false, totalLines: lines.length, outputLines: lines.length, truncatedBy: null as null | "lines" | "bytes" }
  const out: string[] = []
  let bytes = 0
  let truncatedBy: "lines" | "bytes" = "lines"
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const add = Buffer.byteLength(lines[i], "utf8") + (out.length > 0 ? 1 : 0)
    if (bytes + add > maxBytes) { truncatedBy = "bytes"; break }
    out.unshift(lines[i]); bytes += add
  }
  return { content: out.join("\n"), truncated: true, totalLines: lines.length, outputLines: out.length, truncatedBy }
}

function runShell(command: string, cwd: string, timeout?: number, signal?: AbortSignal) {
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

function applyEdits(original: string, edits: Array<{ oldText: string; newText: string }>) {
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

export const PiAgentPlugin: Plugin = async () => ({
  tool: {
    read: tool({
      description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
      args: { path: tool.schema.string().describe("Path to the file to read (relative or absolute)"), offset: tool.schema.number().optional().describe("Line number to start reading from (1-indexed)"), limit: tool.schema.number().optional().describe("Maximum number of lines to read") },
      async execute(args, context) {
        const abs = resolveToCwd(args.path, context.directory)
        await access(abs, constants.R_OK)
        const text = await readFile(abs, "utf8")
        const lines = text.split("\n")
        const start = args.offset ? Math.max(0, args.offset - 1) : 0
        if (start >= lines.length) throw new Error(`Offset ${args.offset} is beyond end of file (${lines.length} lines total)`)
        const selected = args.limit === undefined ? lines.slice(start).join("\n") : lines.slice(start, start + args.limit).join("\n")
        const trunc = truncateHead(selected)
        let out = trunc.content
        if ((trunc as any).firstLineExceedsLimit) out = `[Line ${start + 1} exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${start + 1}p' ${args.path} | head -c ${DEFAULT_MAX_BYTES}]`
        else if (trunc.truncated) out += `\n\n[Showing lines ${start + 1}-${start + trunc.outputLines} of ${lines.length}. Use offset=${start + trunc.outputLines + 1} to continue.]`
        else if (args.limit !== undefined && start + args.limit < lines.length) out += `\n\n[${lines.length - (start + args.limit)} more lines in file. Use offset=${start + args.limit + 1} to continue.]`
        return out
      },
    }),
    bash: tool({
      description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
      args: { command: tool.schema.string().describe("Bash command to execute"), timeout: tool.schema.number().optional().describe("Timeout in seconds (optional, no default timeout)") },
      async execute(args, context) {
        const { code, output } = await runShell(args.command, context.directory, args.timeout, context.abort)
        const trunc = truncateTail(output || "(no output)")
        let text = trunc.content
        if (trunc.truncated) {
          const path = resolve(tmpdir(), `opencode-pi-bash-${Date.now()}.log`)
          await writeFile(path, output, "utf8")
          text += `\n\n[Showing last ${trunc.outputLines} lines of ${trunc.totalLines}. Full output: ${path}]`
        }
        if (code !== 0 && code !== null) throw new Error(`${text}\n\nCommand exited with code ${code}`)
        return text
      },
    }),
    edit: tool({
      description: "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
      args: { path: tool.schema.string().describe("Path to the file to edit (relative or absolute)"), edits: tool.schema.array(tool.schema.object({ oldText: tool.schema.string().describe("Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call."), newText: tool.schema.string().describe("Replacement text for this targeted edit.") })).describe("One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.") },
      async execute(args, context) {
        const abs = resolveToCwd(args.path, context.directory)
        await access(abs, constants.R_OK | constants.W_OK)
        const original = await readFile(abs, "utf8")
        const next = applyEdits(original, args.edits)
        await writeFile(abs, next, "utf8")
        return `Edited ${args.path}: ${args.edits.length} replacement(s) applied.`
      },
    }),
    write: tool({
      description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
      args: { path: tool.schema.string().describe("Path to the file to write (relative or absolute)"), content: tool.schema.string().describe("Content to write to the file") },
      async execute(args, context) {
        const abs = resolveToCwd(args.path, context.directory)
        await mkdir(dirname(abs), { recursive: true })
        await writeFile(abs, args.content, "utf8")
        return `Wrote ${Buffer.byteLength(args.content, "utf8")} bytes to ${args.path}.`
      },
    }),
  },
})

export default PiAgentPlugin
