import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CodexAppServerClient, buildCodexAppServerConfigArgs } from './codex-app-server-client'
import { codexSdkEnv, resolveCodexCliPath } from './codex-driver'

describe('CodexAppServerClient', () => {
  test('handshakes without deadlocking bootstrap on ensureReady', async () => {
    const codexPath = resolveCodexCliPath() ?? join(homedir(), '.bun', 'bin', 'codex')
    if (!existsSync(codexPath)) return

    const client = new CodexAppServerClient({
      codexPath,
      env: codexSdkEnv(),
      configArgs: buildCodexAppServerConfigArgs(false),
      onNotification: () => {},
      onServerRequest: async () => ({}),
    })

    await expect(client.ensureReady()).resolves.toBeUndefined()
    client.dispose()
  })
})
