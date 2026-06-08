import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { FileService, type FileNode } from './file-service'

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd })
}

function flatten(nodes: FileNode[], prefix = ''): string[] {
  const out: string[] = []
  for (const n of nodes) {
    const rel = prefix ? `${prefix}/${n.name}` : n.name
    if (n.type === 'directory') out.push(...flatten(n.children ?? [], rel))
    else out.push(rel)
  }
  return out
}

describe('FileService tree (git-backed)', () => {
  let root: string

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'fs-tree-')))
    await git(root, ['init', '-q'])
    await git(root, ['config', 'user.email', 't@t.t'])
    await git(root, ['config', 'user.name', 't'])
    await writeFile(join(root, 'index.ts'), 'export const x = 1\n')
    await writeFile(join(root, '.gitignore'), '.env.local\nnode_modules\n')
    await git(root, ['add', 'index.ts', '.gitignore'])
    await git(root, ['commit', '-q', '-m', 'init'])
    FileService.invalidateTreeCache()
  })

  afterEach(async () => {
    FileService.invalidateTreeCache()
    await rm(root, { recursive: true, force: true })
  })

  test('surfaces a gitignored .env file without a full fs walk', async () => {
    // .env.local is gitignored, so ls-files --exclude-standard drops it; the
    // git-backed always-visible pass must still surface it.
    await writeFile(join(root, '.env.local'), 'SECRET=1\n')
    const files = flatten(await FileService.getTree(root))
    expect(files).toContain('.env.local')
    expect(files).toContain('.gitignore')
    expect(files).toContain('index.ts')
  })

  test('does not surface an ignored .env nested under a skipped dir', async () => {
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'pkg', '.env'), 'X=1\n')
    const files = flatten(await FileService.getTree(root))
    expect(files.some((f) => f.includes('node_modules'))).toBe(false)
  })

  test('cached structure returns an equal-but-distinct clone (safe to annotate)', async () => {
    const a = await FileService.getTreeStructureCached(root)
    const b = await FileService.getTreeStructureCached(root)
    expect(flatten(b)).toEqual(flatten(a))
    // Distinct object graph — mutating one (as the IPC annotate step does) must
    // not corrupt the cached copy returned to the next caller.
    a[0].gitStatus = 'modified'
    const c = await FileService.getTreeStructureCached(root)
    expect(c[0].gitStatus).toBeUndefined()
  })

  test('listDirectory returns only immediate children (lazy), gitignore-respecting', async () => {
    await mkdir(join(root, 'src', 'deep'), { recursive: true })
    await writeFile(join(root, 'src', 'a.ts'), '//\n')
    await writeFile(join(root, 'src', 'deep', 'b.ts'), '//\n')
    await writeFile(join(root, '.env.local'), 'X=1\n') // gitignored
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'pkg.js'), '//\n')

    const rootChildren = (await FileService.listDirectory(root)).map((n) => n.name)
    // Immediate children only — no 'deep', no 'b.ts'.
    expect(rootChildren).toContain('src')
    expect(rootChildren).toContain('index.ts')
    expect(rootChildren).not.toContain('deep')
    expect(rootChildren).not.toContain('b.ts')
    // node_modules skipped; gitignored .env.local stays (always-visible).
    expect(rootChildren).not.toContain('node_modules')
    expect(rootChildren).toContain('.env.local')

    const srcChildren = (await FileService.listDirectory(join(root, 'src'))).map((n) => n.name)
    expect(srcChildren.sort()).toEqual(['a.ts', 'deep'])
  })

  test('listDirectory sorts directories before files', async () => {
    await writeFile(join(root, 'zzz.ts'), '//\n')
    await mkdir(join(root, 'aaa'), { recursive: true })
    const names = (await FileService.listDirectory(root)).map((n) => `${n.type[0]}:${n.name}`)
    const firstFileIdx = names.findIndex((n) => n.startsWith('f:'))
    const lastDirIdx = names.map((n) => n.startsWith('d:')).lastIndexOf(true)
    expect(lastDirIdx).toBeLessThan(firstFileIdx)
  })

  test('invalidateTreeCache forces a recompute that reflects new files', async () => {
    const before = flatten(await FileService.getTreeStructureCached(root))
    expect(before).not.toContain('added.ts')
    await writeFile(join(root, 'added.ts'), '//\n')
    await git(root, ['add', 'added.ts'])
    FileService.invalidateTreeCache(root)
    const after = flatten(await FileService.getTreeStructureCached(root))
    expect(after).toContain('added.ts')
  })
})
