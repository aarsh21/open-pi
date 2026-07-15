---
id: "0001"
name: Pi tool fidelity baseline
type: wayfinder:research
status: closed
assignee: research-agent
blocked-by: []
---

## Question

What exactly do Pi's four core tools do — precisely enough that a reimplementation can be checked against it? Produce the behavioral ground truth for `read`, `bash`, `edit`, `write` from the vendored source at `pi/packages/coding-agent/src/core/tools/` (including `truncate.ts`, `edit-diff.ts`, `output-accumulator.ts`, `file-mutation-queue.ts`, `path-utils.ts`):

- Tool schemas (parameters, descriptions the model sees).
- Output shaping: truncation limits, byte/line caps, continuation messages, exact wording.
- Edit semantics: matching rules, fuzziness, multi-edit handling, failure messages.
- Bash execution: shell, timeouts, output streaming/accumulation, cwd handling.
- Error behavior and messages for each tool.

Then diff this baseline against the current open-pi implementation (`src/toolRuntime.ts`, `src/toolOutputPolicy.ts`, `src/index.ts`) — a gap table of where v1 diverges. This baseline is what "tool reliability" (v1 pain point) gets measured against.

## Resolution

Ground truth read from `pi/packages/coding-agent/src/core/tools/` (read.ts, bash.ts, edit.ts, write.ts, truncate.ts, edit-diff.ts, output-accumulator.ts, file-mutation-queue.ts, path-utils.ts, tool-definition-wrapper.ts, index.ts) plus `src/utils/shell.ts`, `src/utils/paths.ts`, `src/utils/child-process.ts`. Diffed against open-pi `src/toolRuntime.ts`, `src/toolOutputPolicy.ts`, `src/index.ts`.

### Shared machinery (Pi)

**Truncation (`truncate.ts`)** — two independent limits, whichever is hit first: `DEFAULT_MAX_LINES = 2000`, `DEFAULT_MAX_BYTES = 50 * 1024` (50KB). `formatSize`: `${n}B` / `${(n/1024).toFixed(1)}KB` / `${(n/1048576).toFixed(1)}MB`. Line counting via `splitLinesForCounting`: split on `\n`, **pop the trailing empty element if content ends with `\n`** (so a newline-terminated file of N lines counts N, not N+1). `truncateHead` (read): never returns partial lines; if the first line alone exceeds maxBytes, returns empty content with `firstLineExceedsLimit: true`. Byte accounting adds +1 per newline joiner. `truncateTail` (bash): works backwards from the end; edge case — if the *last* line alone exceeds maxBytes, keeps a UTF-8-boundary-safe **partial** tail of that line and sets `lastLinePartial: true`. `TruncationResult` carries content/truncated/truncatedBy("lines"|"bytes"|null)/totalLines/totalBytes/outputLines/outputBytes/lastLinePartial/firstLineExceedsLimit/maxLines/maxBytes.

**Path resolution (`path-utils.ts` + `utils/paths.ts`)** — `resolveToCwd` uses `resolvePath(filePath, cwd, { normalizeUnicodeSpaces: true, stripAtPrefix: true })`: normalizes Unicode space variants (` `, ` - `, ` `, ` `, `　`) to plain space, strips one leading `@`, expands `~` / `~/`, converts `file://` URLs, then resolves relative to cwd. `resolveReadPathAsync` (read tool only) additionally retries nonexistent paths against macOS filename variants: (1) narrow no-break space before AM/PM (screenshot names), (2) NFD normalization, (3) straight apostrophe → U+2019 curly quote, (4) NFD+curly combined.

**File mutation queue (`file-mutation-queue.ts`)** — `withFileMutationQueue(path, fn)` serializes edit/write operations targeting the same realpath (falls back to resolved path on ENOENT/ENOTDIR); different files run in parallel. Abort is observed via `signal.aborted` checks after each await (never rejects from an abort listener) so the queue stays locked until in-flight fs ops settle.

**Wrapper (`tool-definition-wrapper.ts`)** — `wrapToolDefinition` passes through name/label/description/parameters/`prepareArguments`/`executionMode`/execute. `createCodingToolDefinitions(cwd)` = [read, bash, edit, write].

### read

- **Schema**: `path: string` — "Path to the file to read (relative or absolute)"; `offset?: number` — "Line number to start reading from (1-indexed)"; `limit?: number` — "Maximum number of lines to read".
- **Description**: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.` Prompt guideline: "Use read to examine files instead of cat or sed."
- **Behavior**: resolve via `resolveReadPathAsync` (macOS variants); `fs.access(R_OK)` (raw ENOENT propagates); image MIME sniff → images returned as `[text note "Read image file [mime]" (+resize hints, + "[Current model does not support images. The image will be omitted from this request.]" for non-vision models), image block]`, auto-resized to max 2000x2000 by default. Text: split on `\n`, apply 1-indexed offset; **offset past EOF** → `Offset {offset} is beyond end of file ({N} lines total)`. If `limit` given, slice first, then `truncateHead` on the selection.
- **Continuation messages** (exact):
  - first line over byte limit: `[Line {startLine} is {size}, exceeds 50.0KB limit. Use bash: sed -n '{startLine}p' {path} | head -c 51200]`
  - truncated by lines: `\n\n[Showing lines {start}-{end} of {totalFileLines}. Use offset={end+1} to continue.]`
  - truncated by bytes: `\n\n[Showing lines {start}-{end} of {totalFileLines} (50.0KB limit). Use offset={end+1} to continue.]`
  - user limit stopped early (no truncation): `\n\n[{remaining} more lines in file. Use offset={next} to continue.]`
- Returns `details.truncation` for renderers. Abort → `Operation aborted`.

### bash

- **Schema**: `command: string` — "Bash command to execute"; `timeout?: number` — "Timeout in seconds (optional, no default timeout)".
- **Description**: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`
- **Shell selection** (`getShellConfig`): explicit settings `shellPath` → error `Custom shell path not found: {path}` if missing; Unix: `/bin/bash`, else `which bash`, else `sh`; Windows: Git Bash known locations, then `bash.exe` on PATH (legacy WSL bash gets `-s` + stdin transport), else a detailed install-instructions error. Always `-c` (non-login, non-interactive); **never `$SHELL`**.
- **Spawn**: `spawn(shell, [...args, command], { cwd, detached: non-win32, env: getShellEnv(), stdio: ["ignore","pipe","pipe"], windowsHide: true })`. `getShellEnv()` = process.env with Pi's bin dir prepended to PATH. cwd is pre-checked: `Working directory does not exist: {cwd}\nCannot execute bash commands.` Optional `commandPrefix` (prepended + `\n`) and `spawnHook` (rewrite command/cwd/env). PIDs tracked for shutdown cleanup; process waited via `waitForChildProcess` (post-exit stdio grace so detached descendants' output isn't lost).
- **Timeout**: validated up front — non-finite or <= 0 → `Invalid timeout: must be a finite number of seconds`; > 2147483.647s → `Invalid timeout: maximum is 2147483.647 seconds`. On fire (and on abort): `killProcessTree` — Unix `process.kill(-pid, "SIGKILL")` (fallback single pid), Windows `taskkill /F /T`.
- **Accumulation** (`OutputAccumulator`): streaming `TextDecoder` (multi-byte chunk boundaries safe), bounded rolling tail (~2x maxBytes) in memory, line/byte counters incremental. Once totals exceed maxBytes/maxLines, raw bytes stream to a temp file `{tmpdir}/pi-bash-{16 hex}.log`. Partial output streamed to UI via `onUpdate`, throttled at 100ms.
- **Result text**: tail-truncated output, `(no output)` when empty; footers (exact):
  - last line partial: `\n\n[Showing last {size} of line {endLine} (line is {lastLineSize}). Full output: {tempPath}]`
  - by lines: `\n\n[Showing lines {start}-{end} of {totalLines}. Full output: {tempPath}]`
  - by bytes: `\n\n[Showing lines {start}-{end} of {totalLines} (50.0KB limit). Full output: {tempPath}]`
- **Status errors** (thrown, partial output *first*, joined with `\n\n`): abort → `{output}\n\nCommand aborted`; timeout → `{output}\n\nCommand timed out after {timeout} seconds`; nonzero exit → `{output or "(no output)"}\n\nCommand exited with code {code}`. Exit code `null` (signal-killed without abort/timeout) is treated as success.

### edit

- **Schema**: `path: string` — "Path to the file to edit (relative or absolute)"; `edits: Array<{oldText, newText}>` — array description: "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead."; `oldText` description: "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call."; `newText`: "Replacement text for this targeted edit."
- **Description**: `Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.` Plus 4 promptGuidelines (multi-edit in one call, matched against original, keep oldText minimal-but-unique).
- **Input coercion** (`prepareArguments`): `edits` sent as a JSON *string* is parsed (Opus 4.6 / GLM-5.1 workaround); legacy top-level `oldText`/`newText` appended as an extra edit. Empty/missing edits → `Edit tool input is invalid. edits must contain at least one replacement.`
- **Matching pipeline** (`applyEditsToNormalizedContent`): read file → strip UTF-8 BOM → detect original line ending (first of CRLF vs LF) → normalize to LF (both content and each edit's oldText/newText). Per edit: exact `indexOf` first; if not found, **fuzzy match** in normalized space — `normalizeForFuzzyMatch` = NFKC + strip trailing whitespace per line + smart single/double quotes → ASCII + Unicode dashes (U+2010..U+2015, U+2212) → `-` + special spaces (NBSP, U+2002-200A, U+202F, U+205F, U+3000) → space. If *any* edit needed fuzzy, all matching runs in fuzzy space and the changed line-blocks are overlaid back onto the original so untouched lines keep original bytes. Uniqueness counted in fuzzy space.
- **Failure messages** (exact; single-edit vs multi-edit variants):
  - empty: `oldText must not be empty in {path}.` / `edits[{i}].oldText must not be empty in {path}.`
  - not found: `Could not find the exact text in {path}. The old text must match exactly including all whitespace and newlines.` / `Could not find edits[{i}] in {path}. The oldText must match exactly including all whitespace and newlines.`
  - duplicate: `Found {n} occurrences of the text in {path}. The text must be unique. Please provide more context to make it unique.` / `Found {n} occurrences of edits[{i}] in {path}. Each oldText must be unique. Please provide more context to make it unique.`
  - overlap: `edits[{i}] and edits[{j}] overlap in {path}. Merge them into one edit or target disjoint regions.`
  - no-op: `No changes made to {path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.` / `No changes made to {path}. The replacements produced identical content.`
  - access failure: `Could not edit file: {path}. Error code: {code}.`
- **Write-back**: BOM re-prefixed, original line endings restored. Runs inside `withFileMutationQueue`. Success text: `Successfully replaced {n} block(s) in {path}.` Returns `details` = display diff (line-numbered, 4 context lines), unified patch, `firstChangedLine`.

### write

- **Schema**: `path: string` — "Path to the file to write (relative or absolute)"; `content: string` — "Content to write to the file".
- **Description**: `Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.` Guideline: "Use write only for new files or complete rewrites."
- **Behavior**: `resolveToCwd` → `mkdir -p dirname` → `writeFile(utf-8)`, inside `withFileMutationQueue`, abort checks between steps. Success text: `Successfully wrote {content.length} bytes to {path}` (note: JS string length, i.e. UTF-16 code units, labeled "bytes"; no trailing period).

### Gap table: open-pi v1 vs Pi baseline

| # | Area | Pi baseline | open-pi v1 | Severity |
|---|------|-------------|------------|----------|
| G1 | read: images | Detects image MIME, returns image attachment (auto-resize 2000x2000, bmp supported, non-vision note) | No image handling at all — `readTextFile` only; description still *claims* image support (and omits bmp), so the model is lied to | High |
| G2 | read: line counting | Trailing `\n` does not count as an extra line (`splitLinesForCounting` pops it) | Plain `split("\n")` — newline-terminated files count one extra line; off-by-one in `totalLines`, truncation boundaries, and every continuation message | Med |
| G3 | read: oversized-first-line message | `[Line {n} is {size}, exceeds 50.0KB limit. Use bash: …]` — includes actual line size | Omits `is {size},` | Low |
| G4 | read: byte-truncation footer | Distinct bytes variant `… of {N} (50.0KB limit). Use offset=…` | Single message for both lines/bytes; byte-limit annotation lost | Low |
| G5 | read: path resolution | Unicode-space normalization, `file://`, macOS variant retries (NFD, AM/PM narrow NBSP, curly quote) | Only `~` and `@` handled; no Unicode/macOS fallbacks | Med |
| G6 | bash: shell choice | `/bin/bash` → `which bash` → `sh`, always `-c`, never `$SHELL`; Windows Git Bash logic | `process.env.SHELL \|\| "/bin/bash"` with `-lc` — may run **zsh/fish** (breaking bash syntax) and `-l` sources login profiles (slow, env drift) | High |
| G7 | bash: kill semantics | `killProcessTree`: SIGKILL to process group, Windows `taskkill /F /T`, tracked PIDs killed on parent shutdown | SIGTERM to process group only; ignorable by children; no Windows tree kill; no shutdown tracking | Med |
| G8 | bash: timeout validation | Rejects non-finite/<=0 and > 2147483.647s with exact messages | No validation; `timeout <= 0` silently means "no timeout" | Low |
| G9 | bash: timeout/abort error text | Partial (truncated) output first, then `\n\nCommand timed out after {t} seconds` / `\n\nCommand aborted` | Timeout message *precedes* raw **untruncated** output; abort drops partial output entirely | Med |
| G10 | bash: accumulation | Streaming `TextDecoder`, bounded rolling memory (~100KB), temp file streamed incrementally, 100ms-throttled partial updates | Unbounded string concat (`d.toString()` per chunk — multi-byte UTF-8 chunk splits corrupt output); temp file written whole at end; no streaming updates | High |
| G11 | bash: truncation footer | `[Showing lines {start}-{end} of {total}. Full output: {path}]` (+bytes and last-line-partial variants); temp name `pi-bash-{16hex}.log` | `[Showing last {outputLines} lines of {totalLines}. Full output: {path}]` — different wording, no bytes variant, no partial-last-line handling (a single >50KB line truncates to *empty* content, "Showing last 0 lines"); temp name `opencode-pi-bash-{Date.now()}.log` | Med |
| G12 | bash: cwd check | Pre-checked: `Working directory does not exist: {cwd}\nCannot execute bash commands.` | No check; raw spawn error surfaces | Low |
| G13 | edit: fuzzy matching | Exact then fuzzy (NFKC, trailing-whitespace strip, smart quotes/dashes/spaces → ASCII), unchanged lines byte-preserved | Exact `indexOf` only — any smart-quote/trailing-space mismatch hard-fails | High |
| G14 | edit: BOM + line endings | Strips BOM before match, re-adds; normalizes CRLF→LF for matching, restores original ending | None — CRLF files effectively unmatched by LF oldText; BOM breaks match at file start | High |
| G15 | edit: input coercion | `edits`-as-JSON-string parsed; legacy top-level `oldText`/`newText` accepted; empty edits array rejected with message | None — model quirks (Opus 4.6/GLM-5.1) fail schema or crash | Med |
| G16 | edit: error messages | Exact Pi wordings incl. occurrence counts, single- vs multi-edit variants, `Could not edit file: {path}. Error code: {code}.` | `Edit {n}: oldText not found in file.` / `Edit {n}: oldText is not unique in file.` / `Edit {n}: overlaps another edit.`; raw ENOENT propagates; no count, no path in message | Med |
| G17 | edit: no-op + empty oldText | `No changes made to {path}…`; `oldText must not be empty in {path}.` | Identical-replacement succeeds silently; empty oldText yields misleading "not unique" error | Med |
| G18 | edit/write: concurrency | `withFileMutationQueue` serializes same-file mutations (realpath-keyed) | No serialization — parallel tool calls can interleave read/write | Med |
| G19 | edit/write: success text | `Successfully replaced {n} block(s) in {path}.` / `Successfully wrote {len} bytes to {path}` (JS string length) | `Edited {path}: {n} replacement(s) applied.` / `Wrote {bytes} bytes to {path}.` (Buffer.byteLength, trailing period) | Low |
| G20 | edit: result details | Returns display diff + unified patch + firstChangedLine | Returns plain string, no diff | Low (UI-fidelity) |
| G21 | edit: oldText schema description | "…must be unique in the original file and must not overlap with any other edits[].oldText in the same call." | Shortened paraphrase | Low |
| G22 | all: abort semantics | Read/edit/write check `signal.aborted` between fs ops (`Operation aborted`); bash kills tree | Only bash observes the abort signal | Low |
| G23 | env for bash | `getShellEnv()` prepends Pi bin dir to PATH | Plain `process.env` (acceptable divergence — no Pi bin dir exists) | Info |

**Faithful already**: truncation constants (2000 / 50KB) and head/tail whichever-first algorithm shape, `formatSize`, read schema + description text (minus bmp), bash/write/edit tool descriptions largely verbatim, read continuation messages for the lines-truncated and user-limit cases, offset-beyond-EOF error, multi-edit overlap detection concept, non-zero-exit error shape (`…\n\nCommand exited with code {n}` with `(no output)` fallback).

**Key takeaway**: the highest-severity fidelity gaps are bash execution (shell choice `$SHELL -lc`, unbounded/corruptible accumulation, kill semantics) and edit robustness (no fuzzy match, no BOM/CRLF handling, no input coercion) plus read's phantom image support. These are the concrete targets for the v1 "tool reliability" pain point.
