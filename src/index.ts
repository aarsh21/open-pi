import { type Plugin, tool } from "@opencode-ai/plugin"
import { editTextFile, readTextFile, runShell, writeTextFile } from "./toolRuntime.js"
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatBashOutput, formatReadOutput } from "./toolOutputPolicy.js"

export const PiAgentPlugin: Plugin = async () => ({
  tool: {
    read: tool({
      description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
      args: { path: tool.schema.string().describe("Path to the file to read (relative or absolute)"), offset: tool.schema.number().optional().describe("Line number to start reading from (1-indexed)"), limit: tool.schema.number().optional().describe("Maximum number of lines to read") },
      async execute(args, context) {
        const text = await readTextFile(args.path, context.directory)
        const lines = text.split("\n")
        const start = args.offset ? Math.max(0, args.offset - 1) : 0
        if (start >= lines.length) throw new Error(`Offset ${args.offset} is beyond end of file (${lines.length} lines total)`)
        const selected = args.limit === undefined ? lines.slice(start).join("\n") : lines.slice(start, start + args.limit).join("\n")
        return formatReadOutput(selected, { path: args.path, startLine: start + 1, totalLines: lines.length, explicitLimit: args.limit })
      },
    }),
    bash: tool({
      description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
      args: { command: tool.schema.string().describe("Bash command to execute"), timeout: tool.schema.number().optional().describe("Timeout in seconds (optional, no default timeout)") },
      async execute(args, context) {
        const { code, output } = await runShell(args.command, context.directory, args.timeout, context.abort)
        const text = await formatBashOutput(output)
        if (code !== 0 && code !== null) throw new Error(`${text}\n\nCommand exited with code ${code}`)
        return text
      },
    }),
    edit: tool({
      description: "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
      args: { path: tool.schema.string().describe("Path to the file to edit (relative or absolute)"), edits: tool.schema.array(tool.schema.object({ oldText: tool.schema.string().describe("Exact text for one targeted replacement. It must match a unique, non-overlapping region of the original file."), newText: tool.schema.string().describe("Replacement text for this targeted edit.") })).describe("One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.") },
      async execute(args, context) {
        await editTextFile(args.path, context.directory, args.edits)
        return `Edited ${args.path}: ${args.edits.length} replacement(s) applied.`
      },
    }),
    write: tool({
      description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
      args: { path: tool.schema.string().describe("Path to the file to write (relative or absolute)"), content: tool.schema.string().describe("Content to write to the file") },
      async execute(args, context) {
        await writeTextFile(args.path, context.directory, args.content)
        return `Wrote ${Buffer.byteLength(args.content, "utf8")} bytes to ${args.path}.`
      },
    }),
  },
})

export default PiAgentPlugin
