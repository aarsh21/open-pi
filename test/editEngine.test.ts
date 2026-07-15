import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  applyEditsToNormalizedContent,
  editTextFile,
  prepareEditArguments,
  validateEditInput,
} from "../src/editEngine.js"

describe("applyEditsToNormalizedContent", () => {
  it("applies multiple exact edits against the original content", () => {
    const content = "const a = 1\nconst b = 2\nconst c = 3\n"
    const { newContent } = applyEditsToNormalizedContent(
      content,
      [
        { oldText: "const a = 1", newText: "const a = 10" },
        { oldText: "const c = 3", newText: "const c = 30" },
      ],
      "f.ts",
    )
    expect(newContent).toBe("const a = 10\nconst b = 2\nconst c = 30\n")
  })

  it("falls back to fuzzy matching for smart quotes and trailing whitespace", () => {
    const content = "say(“hello”)   \nkeep me untouched\n"
    const { newContent } = applyEditsToNormalizedContent(
      content,
      [{ oldText: 'say("hello")', newText: 'say("goodbye")' }],
      "f.ts",
    )
    expect(newContent).toContain('say("goodbye")')
    // the untouched line keeps its original bytes
    expect(newContent).toContain("keep me untouched")
  })

  it("reports pi's exact not-found error for a single edit", () => {
    expect(() => applyEditsToNormalizedContent("abc\n", [{ oldText: "zzz", newText: "y" }], "f.ts")).toThrow(
      "Could not find the exact text in f.ts. The old text must match exactly including all whitespace and newlines.",
    )
  })

  it("reports pi's exact multi-edit not-found error with the edit index", () => {
    expect(() =>
      applyEditsToNormalizedContent(
        "abc\n",
        [
          { oldText: "abc", newText: "x" },
          { oldText: "zzz", newText: "y" },
        ],
        "f.ts",
      ),
    ).toThrow("Could not find edits[1] in f.ts. The oldText must match exactly including all whitespace and newlines.")
  })

  it("reports duplicate occurrences with a count", () => {
    expect(() => applyEditsToNormalizedContent("dup\ndup\n", [{ oldText: "dup", newText: "x" }], "f.ts")).toThrow(
      "Found 2 occurrences of the text in f.ts. The text must be unique. Please provide more context to make it unique.",
    )
  })

  it("rejects overlapping edits", () => {
    expect(() =>
      applyEditsToNormalizedContent(
        "abcdef\n",
        [
          { oldText: "abcd", newText: "x" },
          { oldText: "cdef", newText: "y" },
        ],
        "f.ts",
      ),
    ).toThrow("overlap in f.ts. Merge them into one edit or target disjoint regions.")
  })

  it("rejects empty oldText", () => {
    expect(() => applyEditsToNormalizedContent("abc\n", [{ oldText: "", newText: "x" }], "f.ts")).toThrow(
      "oldText must not be empty in f.ts.",
    )
  })

  it("rejects no-op replacements", () => {
    expect(() => applyEditsToNormalizedContent("abc\n", [{ oldText: "abc", newText: "abc" }], "f.ts")).toThrow(
      "No changes made to f.ts. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.",
    )
  })
})

describe("editTextFile", () => {
  it("preserves CRLF line endings and BOM", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-pi-test-"))
    const file = join(dir, "crlf.txt")
    await writeFile(file, "﻿one\r\ntwo\r\nthree\r\n", "utf8")

    await editTextFile("crlf.txt", dir, [{ oldText: "two\nthree", newText: "TWO\nTHREE" }])

    const result = await readFile(file, "utf8")
    expect(result).toBe("﻿one\r\nTWO\r\nTHREE\r\n")
  })
})

describe("prepareEditArguments", () => {
  it("parses edits sent as a JSON string", () => {
    const prepared = prepareEditArguments({ path: "f.ts", edits: '[{"oldText":"a","newText":"b"}]' })
    expect(prepared.edits).toEqual([{ oldText: "a", newText: "b" }])
  })

  it("accepts legacy top-level oldText/newText", () => {
    const prepared = prepareEditArguments({ path: "f.ts", oldText: "a", newText: "b" })
    expect(prepared.edits).toEqual([{ oldText: "a", newText: "b" }])
  })

  it("rejects empty edits via validateEditInput", () => {
    expect(() => validateEditInput({ path: "f.ts", edits: [] })).toThrow(
      "Edit tool input is invalid. edits must contain at least one replacement.",
    )
  })
})
