import { _electron as electron } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'

const appPath = resolve(process.cwd(), 'out/main/index.js')
const app = await electron.launch({ args: [appPath], env: { ...process.env, CI_TEST: '1' } })
const window = await app.firstWindow()
await window.waitForLoadState('domcontentloaded')
await window.waitForSelector('#root', { timeout: 10000 })

await app.evaluate(() => {
  globalThis.__e2eOpenPrsRows = [{
    number: 170,
    state: 'open',
    title: 't',
    url: 'u',
    checkStatus: 'none',
    hasPendingComments: false,
    pendingCommentCount: 0,
    isBlockedByCi: false,
    isApproved: false,
    isChangesRequested: false,
    updatedAt: '2026-01-01T00:00:00Z',
    headRefName: 'h',
    baseRefName: 'main',
    isCrossRepository: false,
  }]
  globalThis.__e2eOpenPrsCallCount = 0
  globalThis.__e2eOpenPrsHandler = () => {
    globalThis.__e2eOpenPrsCallCount = (globalThis.__e2eOpenPrsCallCount ?? 0) + 1
    return { available: true, data: globalThis.__e2eOpenPrsRows ?? [] }
  }
})

const repoPath = join('/tmp', `debug-pr-${Date.now()}`)
mkdirSync(repoPath, { recursive: true })
execSync('git init && git checkout -b main && git config user.email t@t.com && git config user.name T', {
  cwd: repoPath,
  shell: '/bin/bash',
})
writeFileSync(join(repoPath, 'README.md'), '# x\n')
execSync('git add . && git commit -m init', { cwd: repoPath })

const ipcResult = await window.evaluate(async (repo) => {
  return await window.api.github.listOpenPrs(repo)
}, repoPath)

const callCount = await app.evaluate(() => globalThis.__e2eOpenPrsCallCount ?? -1)
const hasHandler = await app.evaluate(() => typeof globalThis.__e2eOpenPrsHandler)

console.log('IPC result:', JSON.stringify(ipcResult))
console.log('callCount:', callCount)
console.log('hasHandler:', hasHandler)

await app.close()
