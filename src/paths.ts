// Ported from pi/packages/coding-agent/src/utils/paths.ts and
// src/core/tools/path-utils.ts (MIT).

import { constants } from "node:fs"
import { access } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join, resolve as nodeResolvePath } from "node:path"
import { fileURLToPath } from "node:url"

const UNICODE_SPACES = /[  -   　]/g
const NARROW_NO_BREAK_SPACE = " "
const RIGHT_SINGLE_QUOTE = "’"

export function normalizePathInput(input: string): string {
  let normalized = input.replace(UNICODE_SPACES, " ")
  if (normalized.startsWith("@")) normalized = normalized.slice(1)

  if (normalized === "~") return homedir()
  if (normalized.startsWith("~/") || (process.platform === "win32" && normalized.startsWith("~\\"))) {
    return join(homedir(), normalized.slice(2))
  }

  if (/^file:\/\//.test(normalized)) return fileURLToPath(normalized)
  return normalized
}

export function resolveToCwd(filePath: string, cwd: string): string {
  const normalized = normalizePathInput(filePath)
  return isAbsolute(normalized) ? nodeResolvePath(normalized) : nodeResolvePath(cwd, normalized)
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

// macOS filename quirks: narrow no-break space before AM/PM in screenshot
// names, NFD-normalized filenames, and U+2019 curly quotes.
export async function resolveReadPath(filePath: string, cwd: string): Promise<string> {
  const resolved = resolveToCwd(filePath, cwd)
  if (await pathExists(resolved)) return resolved

  const amPmVariant = resolved.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`)
  if (amPmVariant !== resolved && (await pathExists(amPmVariant))) return amPmVariant

  const nfdVariant = resolved.normalize("NFD")
  if (nfdVariant !== resolved && (await pathExists(nfdVariant))) return nfdVariant

  const curlyVariant = resolved.replace(/'/g, RIGHT_SINGLE_QUOTE)
  if (curlyVariant !== resolved && (await pathExists(curlyVariant))) return curlyVariant

  const nfdCurlyVariant = nfdVariant.replace(/'/g, RIGHT_SINGLE_QUOTE)
  if (nfdCurlyVariant !== resolved && (await pathExists(nfdCurlyVariant))) return nfdCurlyVariant

  return resolved
}
