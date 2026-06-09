import { describe, expect, it } from 'bun:test'
import { TmuxService } from './tmux-service'

function makeService(responses: Record<string, { stdout?: string; stderr?: string; error?: Error }>) {
  const calls: Array<{ file: string; args: string[] }> = []
  const service = new TmuxService({
    userDataPath: '/Users/test/Library/Application Support/Constellagent',
    tmuxPath: '/opt/homebrew/bin/tmux',
    execFileImpl: async (file, args) => {
      calls.push({ file, args })
      const key = args.join(' ')
      const response = responses[key] ?? responses['*']
      if (!response) return { stdout: '', stderr: '' }
      if (response.error) throw Object.assign(response.error, { stderr: response.stderr ?? '' })
      return { stdout: response.stdout ?? '', stderr: response.stderr ?? '' }
    },
  })
  return { service, calls }
}

describe('TmuxService', () => {
  it('uses an app-scoped socket and stable session names', () => {
    const { service } = makeService({})
    const name = service.makeSessionName(
      'workspace-123',
      '11111111-2222-3333-4444-555555555555',
    )

    expect(service.socketName()).toMatch(/^constellagent-[a-f0-9]{10}$/)
    expect(name).toBe('ca-workspace-123-11111111-2222-3333-4444-555555555555')
    expect(service.parseSessionName(name)).toEqual({
      workspaceId: 'workspace-123',
      terminalId: '11111111-2222-3333-4444-555555555555',
    })
  })

  it('lists only app-owned sessions and filters by workspace', async () => {
    const { service } = makeService({
      [`-L ${serviceSocketPlaceholder()} list-sessions -F #{session_name}\t#{session_created}\t#{session_attached}`]: {
        stdout: [
          'ca-ws-a-11111111-2222-3333-4444-555555555555\t1700000000\t1',
          'user-session\t1700000001\t0',
          'ca-ws-b-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\t1700000002\t0',
        ].join('\n'),
      },
    })

    const summaries = await service.listSessions('ws-a')

    expect(summaries).toEqual([
      {
        backend: 'tmux',
        sessionName: 'ca-ws-a-11111111-2222-3333-4444-555555555555',
        workspaceId: 'ws-a',
        terminalId: '11111111-2222-3333-4444-555555555555',
        createdAt: 1700000000000,
        attachedClients: 1,
      },
    ])
  })

  it('creates a session and hides the tmux status bar globally and per-session', async () => {
    const socket = serviceSocketPlaceholder()
    const { service, calls } = makeService({
      // No existing session → has-session fails, forcing new-session.
      [`-L ${socket} has-session -t ca-ws-a-term`]: { error: new Error('no session') },
      '*': {},
    })

    await service.ensureSession({ sessionName: 'ca-ws-a-term', cwd: '/repo' })

    // The status-off command is chained into new-session so it never flashes.
    const newSession = calls.find((c) => c.args.includes('new-session'))
    expect(newSession?.args.join(' ')).toContain('; set-option -t ca-ws-a-term status off')
    // …and reinforced globally + per-session afterwards.
    expect(calls.some((c) => c.args.join(' ').includes('set-option -g status off'))).toBe(true)
    expect(calls.some((c) => c.args.join(' ').includes('set-option -t ca-ws-a-term status off'))).toBe(true)
  })

  it('hides the status bar even when the session already exists', async () => {
    // Every command (incl. has-session) succeeds → session already exists.
    const { service, calls } = makeService({ '*': {} })

    await service.ensureSession({ sessionName: 'ca-ws-a-term', cwd: '/repo' })

    expect(calls.some((c) => c.args.includes('new-session'))).toBe(false)
    expect(calls.some((c) => c.args.join(' ').includes('set-option -g status off'))).toBe(true)
    expect(calls.some((c) => c.args.join(' ').includes('set-option -t ca-ws-a-term status off'))).toBe(true)
  })

  it('treats a missing tmux server as an empty session list', async () => {
    const { service } = makeService({
      '*': {
        error: new Error('tmux failed'),
        stderr: 'error connecting to /tmp/tmux: no server running',
      },
    })

    await expect(service.listSessions()).resolves.toEqual([])
  })

  it('treats a missing tmux socket file as an empty session list', async () => {
    const { service } = makeService({
      '*': {
        error: new Error('Command failed'),
        stderr:
          'error connecting to /private/tmp/tmux-501/constellagent-0cbbf0e96c (No such file or directory)',
      },
    })

    await expect(service.listSessions()).resolves.toEqual([])
  })
})

function serviceSocketPlaceholder(): string {
  const service = new TmuxService({ userDataPath: '/Users/test/Library/Application Support/Constellagent' })
  return service.socketName()
}
