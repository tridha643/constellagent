export const DEFAULT_AGENTATION_PORT = 4747

export function getAgentationPort(): number {
  const raw = process.env.CONSTELLAGENT_AGENTATION_PORT
  if (raw) {
    const n = Number.parseInt(raw, 10)
    if (Number.isFinite(n) && n > 0 && n < 65536) return n
  }
  return DEFAULT_AGENTATION_PORT
}

export function getEmbeddedAgentationEndpoint(): string {
  return `http://127.0.0.1:${getAgentationPort()}`
}

/** Set by agentation-http-server when the embedded server starts. */
export let embeddedAgentationServerStarted = false

export function markEmbeddedAgentationServerStarted(): void {
  embeddedAgentationServerStarted = true
}
