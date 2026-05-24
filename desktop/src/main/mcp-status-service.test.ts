import { describe, expect, test } from 'bun:test'
import { parseCodexMcpList } from './mcp-status-service'

describe('parseCodexMcpList', () => {
  test('parses bracket-style server lines', () => {
    expect(parseCodexMcpList('[CODEX_APPS] connected\n[linear] connected')).toEqual([
      { name: 'CODEX_APPS', status: 'ok', detail: 'connected' },
      { name: 'linear', status: 'ok', detail: 'connected' },
    ])
  })

  test('returns empty for unconfigured message', () => {
    expect(parseCodexMcpList('No MCP servers configured yet.')).toEqual([])
  })

  test('parses tabular output', () => {
    expect(parseCodexMcpList('CODEX_APPS\tconnected')).toEqual([
      { name: 'CODEX_APPS', status: 'ok', detail: 'connected' },
    ])
  })
})
