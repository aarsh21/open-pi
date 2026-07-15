# open-pi

Pi-style agent and tool plugin for OpenCode.

It installs:

- OpenCode plugin `open-pi`
- Primary OpenCode agent `pi` (a separate agent — your other agents are untouched; the installer asks whether to make it the default)
- Pi's system prompt and Pi-style tools that override OpenCode built-ins:
  - `read`
  - `bash` (always real bash, SIGKILL process-tree cleanup)
  - `edit` (Pi's exact-then-fuzzy matching: smart quotes, trailing whitespace, BOM, CRLF)
  - `write`
- `web_search` — OpenAI web search, available when OpenAI credentials exist (ChatGPT-subscription OAuth from `/connect` or `OPENAI_API_KEY`). Credentials are checked at plugin load, so restart OpenCode after running `/connect`.

Tool output truncation is left to OpenCode's built-in cap, keeping tool results token-lean.

## Install

```bash
bunx @aarsh21/open-pi install
```

or:

```bash
npx @aarsh21/open-pi install
```

The installer updates your OpenCode config and writes the agent prompt to:

```txt
~/.config/opencode/agents/pi.md
```

Then restart OpenCode and switch to the `pi` agent.

## Manual config

If you do not want to use the installer, add the plugin to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@aarsh21/open-pi"],
  "agent": {
    "pi": {
      "description": "Pi-style coding agent with read, bash, edit, and write tools",
      "mode": "primary",
      "prompt": "{file:./agents/pi.md}",
      "permission": {
        "read": "allow",
        "bash": "allow",
        "edit": "allow",
        "glob": "deny",
        "grep": "deny",
        "list": "deny",
        "task": "deny",
        "todowrite": "deny",
        "webfetch": "deny",
        "websearch": "deny",
        "lsp": "deny",
        "skill": "deny",
        "question": "deny"
      }
    }
  }
}
```

And copy `agents/pi.md` into your OpenCode config agents directory.

## Development

```bash
npm install
npm run build
```

For local install while developing:

```bash
node dist/cli.js install
```

The installer detects local development and adds the local package path to OpenCode's plugin array.
