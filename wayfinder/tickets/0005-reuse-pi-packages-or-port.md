---
id: "0005"
name: Reuse Pi packages or port the code
type: wayfinder:grilling
status: closed
assignee: aarsh
blocked-by: ["0001", "0002"]
---

## Question

Should v2 depend on Pi's published packages (e.g. import tool implementations from `@earendil-works/pi-coding-agent` / `pi-agent-core`) or vendor/port the tool code into the plugin? Decide with the user, informed by the fidelity baseline (how much behavior there is to keep in sync) and the control-surface matrix (what shape OpenCode forces the code into). Consider: drift as Pi evolves, package size/coupling, license, and how each option affects proving fidelity.

## Resolution

Port, don't depend. Pi's tool logic is ported into the plugin (`src/editEngine.ts`, `src/bash.ts`, `src/paths.ts`, `src/fileMutationQueue.ts`), checked against the vendored source. Scope was then narrowed by the user: keep the edit engine, path handling, mutation queue, and bash execution semantics; drop the truncation/output-accumulator machinery (OpenCode's cap covers it).
