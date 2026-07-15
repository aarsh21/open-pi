// Ported from pi/packages/coding-agent/src/core/tools/edit-diff.ts and the
// execute path of edit.ts (MIT). Diff/patch generation is omitted — OpenCode
// tool results are plain strings.

import { constants } from "node:fs"
import { access, readFile, writeFile } from "node:fs/promises"
import { withFileMutationQueue } from "./fileMutationQueue.js"
import { resolveToCwd } from "./paths.js"

export interface Edit {
  oldText: string
  newText: string
}

export interface EditToolInput {
  path: string
  edits: Edit[]
}

export function detectLineEnding(content: string): "\r\n" | "\n" {
  const crlfIdx = content.indexOf("\r\n")
  const lfIdx = content.indexOf("\n")
  if (lfIdx === -1) return "\n"
  if (crlfIdx === -1) return "\n"
  return crlfIdx < lfIdx ? "\r\n" : "\n"
}

export function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

export function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text
}

export function stripBom(content: string): { bom: string; text: string } {
  return content.startsWith("﻿") ? { bom: "﻿", text: content.slice(1) } : { bom: "", text: content }
}

export function normalizeForFuzzyMatch(text: string): string {
  return text
    .normalize("NFKC")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/[  -   　]/g, " ")
}

function splitLinesWithEndings(content: string): string[] {
  return content.match(/[^\n]*\n|[^\n]+/g) ?? []
}

interface LineSpan {
  start: number
  end: number
}

interface MatchedEdit {
  editIndex: number
  matchIndex: number
  matchLength: number
  newText: string
}

type TextReplacement = Pick<MatchedEdit, "matchIndex" | "matchLength" | "newText">

function getLineSpans(content: string): LineSpan[] {
  let offset = 0
  return splitLinesWithEndings(content).map((line) => {
    const span = { start: offset, end: offset + line.length }
    offset = span.end
    return span
  })
}

function getReplacementLineRange(lines: LineSpan[], replacement: TextReplacement) {
  const replacementStart = replacement.matchIndex
  const replacementEnd = replacement.matchIndex + replacement.matchLength

  let startLine = -1
  for (let i = 0; i < lines.length; i++) {
    if (replacementStart >= lines[i].start && replacementStart < lines[i].end) {
      startLine = i
      break
    }
  }
  if (startLine === -1) {
    throw new Error("Replacement range is outside the base content.")
  }

  let endLine = startLine
  while (endLine < lines.length && lines[endLine].end < replacementEnd) {
    endLine++
  }
  if (endLine >= lines.length) {
    throw new Error("Replacement range is outside the base content.")
  }

  return { startLine, endLine: endLine + 1 }
}

function applyReplacements(content: string, replacements: TextReplacement[], offset = 0): string {
  let result = content
  for (let i = replacements.length - 1; i >= 0; i--) {
    const replacement = replacements[i]
    const matchIndex = replacement.matchIndex - offset
    result =
      result.substring(0, matchIndex) + replacement.newText + result.substring(matchIndex + replacement.matchLength)
  }
  return result
}

// Overlay replacements matched against a normalized view back onto the
// original so untouched lines keep their original bytes.
export function applyReplacementsPreservingUnchangedLines(
  originalContent: string,
  baseContent: string,
  replacements: TextReplacement[],
): string {
  const originalLines = splitLinesWithEndings(originalContent)
  const baseLines = getLineSpans(baseContent)
  if (originalLines.length !== baseLines.length) {
    throw new Error("Cannot preserve unchanged lines because the base content has a different line count.")
  }

  const groups: Array<{ startLine: number; endLine: number; replacements: TextReplacement[] }> = []
  const sortedReplacements = [...replacements].sort((a, b) => a.matchIndex - b.matchIndex)
  for (const replacement of sortedReplacements) {
    const range = getReplacementLineRange(baseLines, replacement)
    const current = groups[groups.length - 1]
    if (current && range.startLine < current.endLine) {
      current.endLine = Math.max(current.endLine, range.endLine)
      current.replacements.push(replacement)
      continue
    }
    groups.push({ ...range, replacements: [replacement] })
  }

  let originalLineIndex = 0
  let result = ""
  for (const group of groups) {
    result += originalLines.slice(originalLineIndex, group.startLine).join("")
    const groupStartOffset = baseLines[group.startLine].start
    const groupEndOffset = baseLines[group.endLine - 1].end
    result += applyReplacements(baseContent.slice(groupStartOffset, groupEndOffset), group.replacements, groupStartOffset)
    originalLineIndex = group.endLine
  }
  result += originalLines.slice(originalLineIndex).join("")

  return result
}

interface FuzzyMatchResult {
  found: boolean
  index: number
  matchLength: number
  usedFuzzyMatch: boolean
  contentForReplacement: string
}

export function fuzzyFindText(content: string, oldText: string): FuzzyMatchResult {
  const exactIndex = content.indexOf(oldText)
  if (exactIndex !== -1) {
    return { found: true, index: exactIndex, matchLength: oldText.length, usedFuzzyMatch: false, contentForReplacement: content }
  }

  const fuzzyContent = normalizeForFuzzyMatch(content)
  const fuzzyOldText = normalizeForFuzzyMatch(oldText)
  const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText)

  if (fuzzyIndex === -1) {
    return { found: false, index: -1, matchLength: 0, usedFuzzyMatch: false, contentForReplacement: content }
  }

  return { found: true, index: fuzzyIndex, matchLength: fuzzyOldText.length, usedFuzzyMatch: true, contentForReplacement: fuzzyContent }
}

function countOccurrences(content: string, oldText: string): number {
  const fuzzyContent = normalizeForFuzzyMatch(content)
  const fuzzyOldText = normalizeForFuzzyMatch(oldText)
  return fuzzyContent.split(fuzzyOldText).length - 1
}

function getNotFoundError(path: string, editIndex: number, totalEdits: number): Error {
  if (totalEdits === 1) {
    return new Error(
      `Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`,
    )
  }
  return new Error(
    `Could not find edits[${editIndex}] in ${path}. The oldText must match exactly including all whitespace and newlines.`,
  )
}

function getDuplicateError(path: string, editIndex: number, totalEdits: number, occurrences: number): Error {
  if (totalEdits === 1) {
    return new Error(
      `Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`,
    )
  }
  return new Error(
    `Found ${occurrences} occurrences of edits[${editIndex}] in ${path}. Each oldText must be unique. Please provide more context to make it unique.`,
  )
}

function getEmptyOldTextError(path: string, editIndex: number, totalEdits: number): Error {
  if (totalEdits === 1) {
    return new Error(`oldText must not be empty in ${path}.`)
  }
  return new Error(`edits[${editIndex}].oldText must not be empty in ${path}.`)
}

function getNoChangeError(path: string, totalEdits: number): Error {
  if (totalEdits === 1) {
    return new Error(
      `No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`,
    )
  }
  return new Error(`No changes made to ${path}. The replacements produced identical content.`)
}

export function applyEditsToNormalizedContent(
  normalizedContent: string,
  edits: Edit[],
  path: string,
): { baseContent: string; newContent: string } {
  const normalizedEdits = edits.map((edit) => ({
    oldText: normalizeToLF(edit.oldText),
    newText: normalizeToLF(edit.newText),
  }))

  for (let i = 0; i < normalizedEdits.length; i++) {
    if (normalizedEdits[i].oldText.length === 0) {
      throw getEmptyOldTextError(path, i, normalizedEdits.length)
    }
  }

  const initialMatches = normalizedEdits.map((edit) => fuzzyFindText(normalizedContent, edit.oldText))
  const usedFuzzyMatch = initialMatches.some((match) => match.usedFuzzyMatch)
  const replacementBaseContent = usedFuzzyMatch ? normalizeForFuzzyMatch(normalizedContent) : normalizedContent

  const matchedEdits: MatchedEdit[] = []
  for (let i = 0; i < normalizedEdits.length; i++) {
    const edit = normalizedEdits[i]
    const matchResult = fuzzyFindText(replacementBaseContent, edit.oldText)
    if (!matchResult.found) {
      throw getNotFoundError(path, i, normalizedEdits.length)
    }

    const occurrences = countOccurrences(replacementBaseContent, edit.oldText)
    if (occurrences > 1) {
      throw getDuplicateError(path, i, normalizedEdits.length, occurrences)
    }

    matchedEdits.push({
      editIndex: i,
      matchIndex: matchResult.index,
      matchLength: matchResult.matchLength,
      newText: edit.newText,
    })
  }

  matchedEdits.sort((a, b) => a.matchIndex - b.matchIndex)
  for (let i = 1; i < matchedEdits.length; i++) {
    const previous = matchedEdits[i - 1]
    const current = matchedEdits[i]
    if (previous.matchIndex + previous.matchLength > current.matchIndex) {
      throw new Error(
        `edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${path}. Merge them into one edit or target disjoint regions.`,
      )
    }
  }

  const baseContent = normalizedContent
  const newContent = usedFuzzyMatch
    ? applyReplacementsPreservingUnchangedLines(normalizedContent, replacementBaseContent, matchedEdits)
    : applyReplacements(replacementBaseContent, matchedEdits)

  if (baseContent === newContent) {
    throw getNoChangeError(path, normalizedEdits.length)
  }

  return { baseContent, newContent }
}

// Some models (Opus 4.6, GLM-5.1) send edits as a JSON string; older models
// send legacy top-level oldText/newText.
export function prepareEditArguments(input: unknown): EditToolInput {
  if (!input || typeof input !== "object") {
    return input as EditToolInput
  }

  const args = input as Record<string, unknown>

  if (typeof args.edits === "string") {
    try {
      const parsed = JSON.parse(args.edits)
      if (Array.isArray(parsed)) args.edits = parsed
    } catch {}
  }

  const legacy = args as unknown as EditToolInput & { oldText?: unknown; newText?: unknown }
  if (typeof legacy.oldText !== "string" || typeof legacy.newText !== "string") {
    return args as unknown as EditToolInput
  }

  const edits = Array.isArray(legacy.edits) ? [...legacy.edits] : []
  edits.push({ oldText: legacy.oldText, newText: legacy.newText })
  const { oldText: _oldText, newText: _newText, ...rest } = legacy
  return { ...rest, edits } as EditToolInput
}

export function validateEditInput(input: EditToolInput): { path: string; edits: Edit[] } {
  if (!Array.isArray(input.edits) || input.edits.length === 0) {
    throw new Error("Edit tool input is invalid. edits must contain at least one replacement.")
  }
  return { path: input.path, edits: input.edits }
}

export async function editTextFile(
  path: string,
  cwd: string,
  edits: Edit[],
  signal?: AbortSignal,
): Promise<{ editCount: number }> {
  const absolutePath = resolveToCwd(path, cwd)

  return withFileMutationQueue(absolutePath, async () => {
    // Do not reject from an abort listener: that would release the mutation
    // queue while an in-flight fs op may still finish. Checking after each
    // await observes the same aborts while keeping the queue locked.
    const throwIfAborted = (): void => {
      if (signal?.aborted) throw new Error("Operation aborted")
    }

    throwIfAborted()

    try {
      await access(absolutePath, constants.R_OK | constants.W_OK)
    } catch (error: unknown) {
      throwIfAborted()
      const errorMessage = error instanceof Error && "code" in error ? `Error code: ${(error as { code?: string }).code}` : String(error)
      throw new Error(`Could not edit file: ${path}. ${errorMessage}.`)
    }
    throwIfAborted()

    const buffer = await readFile(absolutePath)
    const rawContent = buffer.toString("utf-8")
    throwIfAborted()

    const { bom, text: content } = stripBom(rawContent)
    const originalEnding = detectLineEnding(content)
    const normalizedContent = normalizeToLF(content)
    const { newContent } = applyEditsToNormalizedContent(normalizedContent, edits, path)
    throwIfAborted()

    const finalContent = bom + restoreLineEndings(newContent, originalEnding)
    await writeFile(absolutePath, finalContent, "utf-8")
    throwIfAborted()

    return { editCount: edits.length }
  })
}
