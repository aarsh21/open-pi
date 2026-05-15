# Context

## Domain vocabulary

- **OpenCode plugin** — the package entry that registers Pi-style tools with OpenCode.
- **Pi agent** — the primary OpenCode agent definition installed by this package.
- **Pi-style tool** — a tool exposed by the OpenCode plugin with Pi-compatible behavior and messaging.
- **Tool runtime** — shared behavior used by Pi-style tools: path resolution, command execution, edit application, and output shaping.
- **Tool output policy** — the rules for line/byte truncation and user-facing continuation messages.
- **Installer** — the command-line flow that updates OpenCode configuration and writes the Pi agent file.
- **Installation plan** — the pure description of config and file changes the installer will apply.
- **Agent definition** — the prompt, permissions, and OpenCode agent config for the Pi agent.
