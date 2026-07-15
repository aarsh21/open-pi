---
id: "0003"
name: Pi pillars and their OpenCode analogues
type: wayfinder:research
status: closed
assignee: research-agent
blocked-by: []
---

## Question

Beyond the four tools, what makes Pi *Pi* — and what is each pillar's closest OpenCode analogue? Inventory from `pi/packages/coding-agent/` (src + docs: `system-prompt.ts`, `docs/skills.md`, `docs/prompt-templates.md`, `docs/extensions.md`, `docs/compaction.md`, `docs/sessions.md`, `docs/settings.md`):

- Minimal system prompt: how Pi composes it (tools list, guidelines, project context, skills section, cwd) and how small it actually is.
- Skills, prompt templates, extensions: what each does, how they load, what they add to the prompt.
- Compaction and session handling philosophy.
- The "no permission system" stance and what it implies for agent flow.

For each pillar, name the OpenCode counterpart (skills.mdx, commands.mdx, plugins.mdx, rules.mdx, agents.mdx in `openocode-docs/`), and classify: maps cleanly / partial overlap needing adaptation / no analogue. Output is the menu the "Which Pi pillars go into v2" decision picks from.

## Resolution

Sources: `pi/packages/coding-agent/src/core/system-prompt.ts`, `pi/packages/coding-agent/docs/{skills,prompt-templates,extensions,compaction,sessions,settings,security}.md`, `pi/README.md`; OpenCode side from `openocode-docs/{skills,commands,plugins,rules,agents,permissions,config,tui,cli}.mdx`.

### Pillar inventory (what makes Pi *Pi*)

**1. Minimal system prompt** (`src/core/system-prompt.ts`, `buildSystemPrompt()`)
Composed in fixed order: (a) one identity sentence ("expert coding assistant operating inside pi"); (b) `Available tools:` — one line per tool, from each tool's `promptSnippet` (e.g. read: "Read file contents", bash: "Execute bash commands (ls, grep, find, etc.)"); a tool with no snippet is omitted from the list entirely; (c) `Guidelines:` — deduplicated bullets, defaults are just two ("Be concise in your responses", "Show file paths clearly when working with files") plus a conditional "use bash for ls/rg/find" when grep/find/ls tools are absent; (d) a pi-docs pointer block (paths to README/docs/examples, read only when the user asks about pi itself); (e) optional `appendSystemPrompt` (`.pi/APPEND_SYSTEM.md`); (f) `<project_context>` wrapping AGENTS.md/CLAUDE.md context files verbatim; (g) skills XML section (names + descriptions only, and only when the `read` tool is present); (h) `Current working directory: <cwd>`. A `customPrompt` (`.pi/SYSTEM.md`) replaces (a)-(d) wholesale but still gets context files, skills, and cwd appended. **Size: the entire static scaffold is ~30 lines / roughly 1.5 KB — a few hundred tokens before project context and skill descriptions.** Everything else (skills bodies, docs) is pulled in on-demand via `read`.

**2. Skills** (`docs/skills.md`)
Agent Skills standard (agentskills.io), lenient validation (warnings, not failures; missing description is the only hard reject; name need not match directory). Directories with `SKILL.md` (name + description frontmatter, freeform body, scripts/assets alongside). Loaded from `~/.pi/agent/skills/`, `~/.agents/skills/`, project `.pi/skills/` and `.agents/skills/` (ancestor walk, trust-gated), packages, settings arrays, `--skill`. Progressive disclosure: only name+description live in the system prompt; the agent `read`s the full SKILL.md when a task matches — no dedicated skill tool. Skills also auto-register as `/skill:name` commands (args appended as `User: <args>`); `disable-model-invocation` hides a skill from the prompt so it is command-only.

**3. Prompt templates** (`docs/prompt-templates.md`)
Markdown snippets that expand into user prompts via `/name`. Locations: `~/.pi/agent/prompts/`, project `.pi/prompts/` (trust-gated), packages, settings, `--prompt-template`. Frontmatter: optional `description` and `argument-hint`. Bash-style argument interpolation: `$1..$n`, `$@`/`$ARGUMENTS`, defaults `${1:-x}`, slices `${@:N}`/`${@:N:L}`. Pure text expansion — no agent/model routing, no shell execution, no file inlining.

**4. Extensions** (`docs/extensions.md`)
TypeScript modules (loaded via jiti, no compile step) exporting a factory over `ExtensionAPI`. Capabilities: lifecycle/tool/session/model event hooks (including blocking or rewriting `tool_call`s), `registerTool` (TypeBox schemas), `registerCommand`, `registerShortcut`, `registerFlag`, interactive UI (`ctx.ui.confirm/select/input/notify`, widgets, full custom TUI components), custom rendering of tool calls/messages, session-persistent state via `pi.appendEntry()`, custom compaction. Locations: `~/.pi/agent/extensions/`, project `.pi/extensions/` (trust-gated), packages, `-e`. Extensions are explicitly the mechanism for permission gates, path protection, checkpointing — i.e. policy is userland, not core.

**5. Compaction** (`docs/compaction.md`)
Auto-compaction when `contextTokens > contextWindow - reserveTokens` (16384 default), keeping `keepRecentTokens` (20k) of recent turns; manual `/compact [instructions]`. Cut at turn boundaries (never between tool call and result); split-turn handling with dual summaries; structured summary format (Goal / Constraints / Progress / Key Decisions / Next Steps / Critical Context) plus cumulative `<read-files>`/`<modified-files>` tracking across repeated compactions. Extension override via `session_before_compact` (cancel or supply custom summary). Sibling mechanism: branch summarization on `/tree` navigation (`session_before_tree`).

**6. Sessions** (`docs/sessions.md`)
JSONL **tree** files under `~/.pi/agent/sessions/` per working directory; every entry has id/parentId, current position is a leaf. `/tree` navigates to any earlier point and continues (new branch in the same file), with optional branch summary injected; `/fork` and `/clone` create new files; labels, `pi -c`/`-r`, `--no-session` ephemeral mode. Philosophy: never lose a path, branch instead of overwrite.

**7. Settings & project trust** (`docs/settings.md`, `docs/security.md`)
Global `~/.pi/agent/settings.json` deep-merged with project `.pi/settings.json`. Resource arrays (packages/extensions/skills/prompts/themes) with globs and force-include/exclude. Project trust is an *input-loading* guard only: untrusted projects don't get their settings/extensions/skills/prompts loaded (`defaultProjectTrust`, `trust.json`, `--approve`); AGENTS.md/CLAUDE.md load regardless.

**8. "No permission system" stance** (`pi/README.md`, `docs/security.md`)
No built-in permission prompts, no sandbox, no allow/ask/deny. Tools run with the launching user's full permissions. Rationale: a partial in-process sandbox would be misread as a security boundary; real isolation must come from OS/container (Gondolin micro-VM, Docker, OpenShell patterns in containerization.md). Consequence for agent flow: zero approval interrupts — the agent runs straight through; anyone wanting gates writes an extension (`tool_call` + `ctx.ui.confirm`), making safety policy opt-in userland code.

### Mapping table

| # | Pi pillar | OpenCode analogue | Classification | What adopting it in an OpenCode plugin takes |
|---|-----------|-------------------|----------------|---------------------------------------------|
| 1 | Minimal system prompt | `agents.mdx` (`prompt` frontmatter per agent) + `rules.mdx` (AGENTS.md = Pi's `<project_context>`) | **Partial overlap** | Define a custom primary agent whose `prompt` is a Pi-style ~30-line scaffold (identity + one-line tool list + 2 guidelines + cwd). AGENTS.md context comes free via rules. Can't fully match: OpenCode still owns tool descriptions/harness plumbing, and prompt is per-agent config, not composed from tool `promptSnippet`s. No plugin hook to rewrite the final assembled system prompt. |
| 2 | Skills | `skills.mdx` (native `skill` tool, same Agent Skills standard) | **Maps cleanly** | Nothing to build — OpenCode already loads `SKILL.md` from `.opencode/skills/`, `.claude/skills/`, `.agents/skills/`. Deltas to accept or paper over: OpenCode loads via `skill` tool instead of `read` (breaks Pi's "relative paths from the skill dir" reading habit slightly), enforces name==dirname (Pi is lenient), no `/skill:name` command registration (could emulate with a generated command per skill), adds per-skill permissions Pi lacks. |
| 3 | Prompt templates | `commands.mdx` (markdown commands, `$ARGUMENTS`/`$1..$n`) | **Maps cleanly** | Drop the same .md files into `.opencode/commands/`. OpenCode is a superset in routing (agent/model/subtask frontmatter, !`shell` injection, @file inlining) but lacks Pi's `${1:-default}` and `${@:N:L}` slicing and `argument-hint` — a plugin could pre-expand those in `tui.prompt.append`/command templates if needed, or just don't use them. |
| 4 | Extensions | `plugins.mdx` (+ custom tools) | **Partial overlap needing adaptation** | Event hooks, custom tools, tool blocking (`tool.execute.before` + throw), env injection, compaction hook all map. Missing in OpenCode plugins: interactive UI primitives (confirm/select/input dialogs), custom TUI components/rendering, `registerShortcut`/`registerFlag`, first-class session-entry persistence. Pi extensions relying on `ctx.ui.*` need redesign (e.g. use permission `ask` flow, toasts via `tui.toast.show`, or move interaction into tool results). |
| 5 | Compaction | `tui.mdx` `/compact` + hidden compaction agent (`agents.mdx`) + `experimental.session.compacting` plugin hook (`plugins.mdx`) | **Partial overlap** | Auto+manual compaction and custom-summary injection exist. A plugin can inject Pi's structured summary format and file tracking via `output.prompt`/`output.context` in `experimental.session.compacting`. Not reachable from a plugin: Pi's cut-point mechanics (keepRecentTokens, turn-boundary/split-turn logic), cumulative details across compactions, cancel/replace with fully custom `CompactionEntry`. |
| 6 | Session trees (`/tree`, branch summaries, `/fork`, `/clone`) | `cli.mdx`/`tui.mdx`: sessions, `--fork` on continue, `/undo`+`/redo`, `/sessions` | **No analogue** (for the tree) | OpenCode sessions are linear with undo/redo and fork-on-continue; there is no in-session tree, no navigate-to-any-node, no branch summarization. A plugin cannot add this — it would require core session-storage changes. Nearest workflow substitute: `/undo` chains + `opencode --fork`. This is the pillar with the widest gap. |
| 7 | Settings layering + project trust | `config.mdx` (global + project `opencode.json` merge) | Layering: **maps cleanly**. Trust: **no direct analogue** | opencode.json global/project merge covers settings layering. OpenCode has no trust prompt gating whether project-local config/plugins load — it loads them and relies on the permission system at execution time instead. Emulating Pi trust in a plugin is not really possible (plugins are already loaded by then); accept OpenCode's execution-time model. |
| 8 | No permission system | `permissions.mdx` — the philosophical opposite | **No analogue (inverted)** | To get Pi's frictionless flow in OpenCode: `"permission": "allow"` (or `--auto`) in opencode.json, keeping targeted `deny` rules (.env already denied by default). That is config, not a plugin. Conversely, Pi-style *userland* gates are what OpenCode's permission config already does declaratively — so "adopting" this pillar means shipping a permissive default permission profile alongside the plugin, plus documentation telling users to containerize for isolation (Pi's own advice). |

### Decision-menu summary for "Which Pi pillars go into v2"

- **Free (already there):** skills (2), prompt templates as commands (3), settings layering (7a). Cost is near zero; pick these by default.
- **Cheap plugin work:** minimal-prompt agent definition (1), Pi-format compaction summaries via the compacting hook (5), permissive-permission profile (8).
- **Real adaptation:** any Pi extension behaviors relying on interactive UI or custom rendering (4).
- **Off the table for a plugin:** session trees / branch summaries (6) and load-time project trust (7b) — core-engine territory, not plugin territory.
