import { writeFile } from "node:fs/promises"
import { piAgentFile } from "./agentDefinition.js"

await writeFile("agents/pi.md", piAgentFile({ enableTodo: false, enableQuestion: false }), "utf8")
