import { writeFile } from "node:fs/promises"
import { piAgentFile } from "./agentDefinition.js"

await writeFile("agents/pi.md", piAgentFile(false), "utf8")
