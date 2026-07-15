import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { type Plugin, tool } from "@opencode-ai/plugin"
import { runShell } from "./bash.js"
import { editTextFile, prepareEditArguments, validateEditInput } from "./editEngine.js"
import { withFileMutationQueue } from "./fileMutationQueue.js"
import { resolveReadPath, resolveToCwd } from "./paths.js"
import { hasOpenAICredentials, openAIWebSearch } from "./webSearch.js"

function splitLines(text: string): string[] {
  if (text.length === 0) return [""]
  const lines = text.split("\n")
  if (text.endsWith("\n") && lines.length > 1) lines.pop()
  return lines
}

// Default line cap so large files always come back with a deterministic
// continuation pointer instead of an opaque byte-level cut.
const READ_DEFAULT_MAX_LINES = 2000

const readTool = tool({
  description: `Read the contents of a file. Output is capped at ${READ_DEFAULT_MAX_LINES} lines; use offset/limit to continue through large files.`,
  args: {
    path: tool.schema.string().describe("Path to the file to read (relative or absolute)"),
    offset: tool.schema.number().optional().describe("Line number to start reading from (1-indexed)"),
    limit: tool.schema.number().optional().describe("Maximum number of lines to read"),
  },
  async execute(args, context) {
    const abs = await resolveReadPath(args.path, context.directory)
    const text = await readFile(abs, "utf8")
    const lines = splitLines(text)
    const start = args.offset ? Math.max(0, args.offset - 1) : 0
    if (start >= lines.length) {
      throw new Error(`Offset ${args.offset} is beyond end of file (${lines.length} lines total)`)
    }
    const maxLines = args.limit === undefined ? READ_DEFAULT_MAX_LINES : args.limit
    const end = Math.min(start + maxLines, lines.length)
    let out = lines.slice(start, end).join("\n")
    if (end < lines.length) {
      out += `\n\n[Showing lines ${start + 1}-${end} of ${lines.length}. Use offset=${end + 1} to continue.]`
    }
    return out
  },
})

const bashTool = tool({
  description:
    "Execute a bash command in the current working directory. Returns stdout and stderr. Optionally provide a timeout in seconds.",
  args: {
    command: tool.schema.string().describe("Bash command to execute"),
    timeout: tool.schema.number().optional().describe("Timeout in seconds (optional, no default timeout)"),
  },
  async execute(args, context) {
    return runShell(args.command, context.directory, { timeout: args.timeout, signal: context.abort })
  },
})

const editTool = tool({
  description:
    "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
  args: {
    path: tool.schema.string().describe("Path to the file to edit (relative or absolute)"),
    // The string branch tolerates models that send edits as a JSON string
    // (Opus 4.6, GLM-5.1); prepareEditArguments parses it before validation.
    edits: tool.schema
      .union([
        tool.schema.array(
          tool.schema.object({
            oldText: tool.schema
              .string()
              .describe(
                "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
              ),
            newText: tool.schema.string().describe("Replacement text for this targeted edit."),
          }),
        ),
        tool.schema.string(),
      ])
      .describe(
        "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
      ),
  },
  async execute(args, context) {
    const { path, edits } = validateEditInput(prepareEditArguments(args))
    const { editCount } = await editTextFile(path, context.directory, edits, context.abort)
    return `Successfully replaced ${editCount} block(s) in ${path}.`
  },
})

const writeTool = tool({
  description:
    "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
  args: {
    path: tool.schema.string().describe("Path to the file to write (relative or absolute)"),
    content: tool.schema.string().describe("Content to write to the file"),
  },
  async execute(args, context) {
    const abs = resolveToCwd(args.path, context.directory)
    await withFileMutationQueue(abs, async () => {
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, args.content, "utf8")
    })
    return `Successfully wrote ${args.content.length} bytes to ${args.path}`
  },
})

const webSearchTool = tool({
  description:
    "Search the web via OpenAI web search. Returns a concise answer with cited sources. Use for current events, documentation, or anything outside the local project.",
  args: {
    query: tool.schema.string().describe("Search query"),
    numResults: tool.schema.number().optional().describe("Maximum sources to cite (default 5, max 20)"),
    recencyFilter: tool.schema
      .enum(["day", "week", "month", "year"])
      .optional()
      .describe("Prefer results from this recent period"),
    domainFilter: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe('Restrict to these domains; prefix with "-" to exclude a domain'),
  },
  async execute(args, context) {
    return openAIWebSearch(args, context.abort)
  },
})

export const PiAgentPlugin: Plugin = async () => {
  const tools: Record<string, ReturnType<typeof tool>> = {
    read: readTool,
    bash: bashTool,
    edit: editTool,
    write: writeTool,
  }
  // Credentials-gated: only expose web search when OpenAI auth exists, so the
  // agent never sees a dead tool.
  if (await hasOpenAICredentials()) {
    tools.web_search = webSearchTool
  }
  return { tool: tools }
}

export default PiAgentPlugin
