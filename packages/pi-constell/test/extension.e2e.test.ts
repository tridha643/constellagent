import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import piConstell from '../extensions/pi-constell.js'

type Handler = (event: any, ctx: any) => any

class FakeAPI {
  tools: any[] = []
  commands = new Map<string, any>()
  flags = new Map<string, unknown>()
  events = new Map<string, Handler[]>()
  activeTools = ['read', 'bash', 'edit', 'write']
  entries: Array<{ type: string; customType: string; data: unknown }> = []

  registerTool(tool: any): void { this.tools.push(tool) }
  registerCommand(name: string, command: any): void { this.commands.set(name, command) }
  registerFlag(name: string, flag: any): void { this.flags.set(name, flag.default) }
  on(name: string, handler: Handler): void {
    const handlers = this.events.get(name) ?? []
    handlers.push(handler)
    this.events.set(name, handlers)
  }
  getFlag(name: string): unknown { return this.flags.get(name) }
  getActiveTools(): string[] { return [...this.activeTools] }
  setActiveTools(names: string[]): void { this.activeTools = [...names] }
  appendEntry(customType: string, data: unknown): void { this.entries.push({ type: 'custom', customType, data }) }
}

function createCtx(cwd: string, entries: any[] = []) {
  const notifications: string[] = []
  const statuses = new Map<string, string | undefined>()
  return {
    cwd,
    hasUI: true,
    model: { provider: 'anthropic', id: 'claude-sonnet-4-5' },
    ui: {
      theme: {
        fg: (_name: string, text: string) => text,
      },
      notify: (message: string) => { notifications.push(message) },
      setStatus: (name: string, text?: string) => { statuses.set(name, text) },
      custom: async () => ({ cancelled: true, answers: [] }),
    },
    sessionManager: {
      getEntries: () => entries,
    },
    _notifications: notifications,
    _statuses: statuses,
  }
}

async function emit(api: FakeAPI, name: string, event: any, ctx: any) {
  const handlers = api.events.get(name) ?? []
  const results = []
  for (const handler of handlers) results.push(await handler(event, ctx))
  return results
}

test('extension registers askUserQuestion and plan command', () => {
  const api = new FakeAPI()
  piConstell(api as any)
  assert.ok(api.tools.some((tool) => tool.name === 'askUserQuestion'))
  assert.ok(api.commands.has('plan'))
})

test('plan mode only allows writes to the active plan file and auto-saves plans', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-constell-e2e-'))
  const api = new FakeAPI()
  piConstell(api as any)
  const ctx = createCtx(cwd)

  await api.commands.get('plan')!.handler('', ctx)
  assert.ok(api.activeTools.includes('askUserQuestion'))
  assert.ok(api.activeTools.includes('write'))
  assert.ok(api.activeTools.includes('edit'))

  const [beforeAgentStart] = await emit(api, 'before_agent_start', {
    prompt: 'improve the plan mode questionnaire ux',
  }, ctx)
  assert.ok(beforeAgentStart?.message?.content.includes('.pi-constell/plans/'))

  const blocked = await emit(api, 'tool_call', {
    toolName: 'write',
    input: { path: 'README.md', content: 'nope' },
  }, ctx)
  assert.equal(blocked[0]?.block, true)

  const activePath = beforeAgentStart.message.content.split('active plan file: ')[1]!.split('\n')[0]!
  const allowed = await emit(api, 'tool_call', {
    toolName: 'write',
    input: { path: activePath, content: '# Draft plan' },
  }, ctx)
  assert.equal(allowed[0], undefined)

  await emit(api, 'agent_end', {
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: `# Improve plan mode questionnaire UX

## Goal
Ship a better planning flow.

## Plan
1. Add askUserQuestion
2. Add tests` },
        ],
      },
    ],
  }, ctx)

  const successNotice = ctx._notifications.find((message: string) => message.includes('saved plan'))
  assert.ok(successNotice)
  const savedPath = successNotice.split(': ').pop()!
  const saved = await readFile(savedPath, 'utf-8')
  assert.match(saved, /# Improve plan mode questionnaire UX/)
})
