import { describe, expect, it } from "vitest"
import { runShell } from "../src/bash.js"

describe("runShell", () => {
  it("runs commands and returns combined output", async () => {
    const output = await runShell("echo out; echo err 1>&2", process.cwd())
    expect(output).toContain("out")
    expect(output).toContain("err")
  })

  it("always uses real bash, never $SHELL", async () => {
    const output = await runShell("echo ${BASH_VERSION:-missing}", process.cwd())
    expect(output.trim()).not.toBe("missing")
  })

  it("returns (no output) for silent commands", async () => {
    await expect(runShell("true", process.cwd())).resolves.toBe("(no output)")
  })

  it("throws with output first and exit code last", async () => {
    await expect(runShell("echo boom; exit 3", process.cwd())).rejects.toThrow(/boom[\s\S]*Command exited with code 3/)
  })

  it("kills on timeout with pi's message", async () => {
    await expect(runShell("sleep 5", process.cwd(), { timeout: 0.3 })).rejects.toThrow(
      "Command timed out after 0.3 seconds",
    )
  }, 10_000)

  it("validates timeout up front", async () => {
    await expect(runShell("true", process.cwd(), { timeout: -1 })).rejects.toThrow(
      "Invalid timeout: must be a finite number of seconds",
    )
    await expect(runShell("true", process.cwd(), { timeout: 3_000_000 })).rejects.toThrow(
      "Invalid timeout: maximum is 2147483.647 seconds",
    )
  })

  it("rejects a missing working directory before spawning", async () => {
    await expect(runShell("true", "/nonexistent-open-pi-dir")).rejects.toThrow(
      "Working directory does not exist: /nonexistent-open-pi-dir\nCannot execute bash commands.",
    )
  })

  it("decodes multi-byte UTF-8 split across chunks", async () => {
    const output = await runShell('printf "héllo wörld ✓"', process.cwd())
    expect(output).toContain("héllo wörld ✓")
  })
})
