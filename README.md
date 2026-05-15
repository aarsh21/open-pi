# open-pi

Pi-style agent and tool plugin for OpenCode.

It installs:

- OpenCode plugin `open-pi`
- Primary OpenCode agent `pi`
- Pi-style tools that override OpenCode built-ins:
  - `read`
  - `bash`
  - `edit`
  - `write`

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
        "edit": "allow"
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
