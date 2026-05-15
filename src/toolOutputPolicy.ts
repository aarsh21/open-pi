import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { writeFile } from "node:fs/promises"

export const DEFAULT_MAX_LINES = 2000
export const DEFAULT_MAX_BYTES = 50 * 1024

type TruncationDirection = "head" | "tail"
type TruncatedBy = "lines" | "bytes"

type TruncationResult = {
  content: string
  truncated: boolean
  totalLines: number
  outputLines: number
  truncatedBy: TruncatedBy | null
  firstLineExceedsLimit?: boolean
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function truncate(content: string, direction: TruncationDirection, maxLines = DEFAULT_MAX_LINES, maxBytes = DEFAULT_MAX_BYTES): TruncationResult {
  const lines = content.split("\n")
  const totalBytes = Buffer.byteLength(content, "utf8")
  if (lines.length <= maxLines && totalBytes <= maxBytes) {
    return { content, truncated: false, totalLines: lines.length, outputLines: lines.length, truncatedBy: null }
  }

  if (direction === "head" && Buffer.byteLength(lines[0] ?? "", "utf8") > maxBytes) {
    return { content: "", truncated: true, totalLines: lines.length, outputLines: 0, truncatedBy: "bytes", firstLineExceedsLimit: true }
  }

  const out: string[] = []
  let bytes = 0
  let truncatedBy: TruncatedBy = "lines"
  const indexes = direction === "head"
    ? Array.from({ length: Math.min(lines.length, maxLines) }, (_, i) => i)
    : Array.from({ length: lines.length }, (_, i) => lines.length - 1 - i)

  for (const index of indexes) {
    if (out.length >= maxLines) break
    const add = Buffer.byteLength(lines[index], "utf8") + (out.length > 0 ? 1 : 0)
    if (bytes + add > maxBytes) { truncatedBy = "bytes"; break }
    if (direction === "head") out.push(lines[index])
    else out.unshift(lines[index])
    bytes += add
  }

  return { content: out.join("\n"), truncated: true, totalLines: lines.length, outputLines: out.length, truncatedBy }
}

export function formatReadOutput(selected: string, args: { path: string; startLine: number; totalLines: number; explicitLimit?: number }) {
  const trunc = truncate(selected, "head")
  if (trunc.firstLineExceedsLimit) {
    return `[Line ${args.startLine} exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${args.startLine}p' ${args.path} | head -c ${DEFAULT_MAX_BYTES}]`
  }
  let out = trunc.content
  if (trunc.truncated) {
    out += `\n\n[Showing lines ${args.startLine}-${args.startLine + trunc.outputLines - 1} of ${args.totalLines}. Use offset=${args.startLine + trunc.outputLines} to continue.]`
  } else if (args.explicitLimit !== undefined && args.startLine - 1 + args.explicitLimit < args.totalLines) {
    out += `\n\n[${args.totalLines - (args.startLine - 1 + args.explicitLimit)} more lines in file. Use offset=${args.startLine + args.explicitLimit} to continue.]`
  }
  return out
}

export async function formatBashOutput(output: string) {
  const trunc = truncate(output || "(no output)", "tail")
  let text = trunc.content
  if (trunc.truncated) {
    const path = resolve(tmpdir(), `opencode-pi-bash-${Date.now()}.log`)
    await writeFile(path, output, "utf8")
    text += `\n\n[Showing last ${trunc.outputLines} lines of ${trunc.totalLines}. Full output: ${path}]`
  }
  return text
}
