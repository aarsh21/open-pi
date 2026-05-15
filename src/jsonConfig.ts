export type OpenCodeConfig = Record<string, any>

export function stripJsonComments(json: string) {
  return json
    .replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, c) => c ? "" : m)
    .replace(/\\"|"(?:\\"|[^"])*"|(,)(\s*[}\]])/g, (m, c, close) => c ? close : m)
}

export function parseOpenCodeConfig(text: string): OpenCodeConfig {
  if (!text.trim()) return {}
  return JSON.parse(stripJsonComments(text))
}

export function serializeOpenCodeConfig(config: OpenCodeConfig) {
  return `${JSON.stringify(config, null, 2)}\n`
}
