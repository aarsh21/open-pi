import { mkdtemp, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { resolveReadPath, resolveToCwd } from "../src/paths.js"

describe("resolveToCwd", () => {
  it("expands ~ to the home directory", () => {
    expect(resolveToCwd("~/x.txt", "/tmp")).toBe(join(homedir(), "x.txt"))
  })

  it("strips a leading @", () => {
    expect(resolveToCwd("@src/a.ts", "/repo")).toBe("/repo/src/a.ts")
  })

  it("resolves relative paths against cwd", () => {
    expect(resolveToCwd("a/b.ts", "/repo")).toBe("/repo/a/b.ts")
  })

  it("normalizes unicode spaces", () => {
    expect(resolveToCwd("a b.txt", "/repo")).toBe("/repo/a b.txt")
  })
})

describe("resolveReadPath", () => {
  it("falls back to the NFD variant of a filename", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-pi-nfd-"))
    const nfdName = "café.txt".normalize("NFD")
    await writeFile(join(dir, nfdName), "x", "utf8")

    const resolved = await resolveReadPath("café.txt".normalize("NFC"), dir)
    expect(resolved.normalize("NFC")).toBe(join(dir, "café.txt").normalize("NFC"))
  })
})
