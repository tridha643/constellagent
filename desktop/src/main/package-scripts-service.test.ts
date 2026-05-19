import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readPackageScripts } from './package-scripts-service'

let workDir: string

beforeEach(() => {
  workDir = join(tmpdir(), `pkg-scripts-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(workDir, { recursive: true })
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

describe('readPackageScripts', () => {
  it('returns scripts from a package.json in the working dir', () => {
    writeFileSync(
      join(workDir, 'package.json'),
      JSON.stringify({ scripts: { dev: 'bun dev', build: 'bun build', lint: 'eslint .' } }),
    )
    const result = readPackageScripts(workDir)
    expect(result.missing).toBe(false)
    expect(result.packageJsonPath).toBe(join(workDir, 'package.json'))
    expect(result.scripts.map((s) => s.name)).toEqual(['dev', 'build', 'lint'])
  })

  it('walks up to nearest package.json from a subfolder', () => {
    writeFileSync(
      join(workDir, 'package.json'),
      JSON.stringify({ scripts: { dev: 'bun dev' } }),
    )
    const sub = join(workDir, 'apps', 'web')
    mkdirSync(sub, { recursive: true })
    const result = readPackageScripts(sub)
    expect(result.missing).toBe(false)
    expect(result.scripts).toHaveLength(1)
    expect(result.scripts[0].name).toBe('dev')
  })

  it('returns missing=true when no package.json exists upward', () => {
    const sub = join(workDir, 'deep', 'nested')
    mkdirSync(sub, { recursive: true })
    // Stop the walk at the synthetic git root so it doesn't crawl outside /tmp.
    mkdirSync(join(workDir, '.git'), { recursive: true })
    const result = readPackageScripts(sub)
    expect(result.missing).toBe(true)
    expect(result.scripts).toEqual([])
    expect(result.packageJsonPath).toBeNull()
  })

  it('sorts well-known scripts first then alphabetical', () => {
    writeFileSync(
      join(workDir, 'package.json'),
      JSON.stringify({
        scripts: {
          format: 'prettier --write .',
          build: 'tsc',
          dev: 'vite',
          'test:watch': 'vitest',
          custom: 'echo hi',
          lint: 'eslint .',
          start: 'node server.js',
        },
      }),
    )
    const result = readPackageScripts(workDir)
    const order = result.scripts.map((s) => s.name)
    // Well-known order: dev, start, serve, test, test:watch, build, lint — then alpha (custom, format)
    expect(order).toEqual(['dev', 'start', 'test:watch', 'build', 'lint', 'custom', 'format'])
  })
})
