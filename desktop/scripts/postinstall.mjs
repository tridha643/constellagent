import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(__dirname, '..')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: desktopRoot,
    stdio: 'inherit',
    ...options,
  })

  if (result.error) throw result.error
  return result.status ?? 1
}

function ensureElectronInstalled() {
  const electronDir = resolve(desktopRoot, 'node_modules/electron')
  const electronInstallScript = resolve(electronDir, 'install.js')
  const electronPathFile = resolve(electronDir, 'path.txt')
  const electronDistDir = resolve(electronDir, 'dist')

  if (!existsSync(electronInstallScript)) {
    return
  }

  if (existsSync(electronPathFile) && existsSync(electronDistDir)) {
    return
  }

  console.warn('[postinstall] Electron runtime not found; running electron install script...')
  const installStatus = run('node', [electronInstallScript])
  if (installStatus !== 0) process.exit(installStatus)
}

function hasWindowsCppToolchain() {
  if (process.platform !== 'win32') return true

  const clCheck = spawnSync('cmd.exe', ['/d', '/s', '/c', 'where cl'], {
    cwd: desktopRoot,
    stdio: 'ignore',
  })
  if (clCheck.status === 0) return true

  const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe'
  if (existsSync(vswhere)) {
    const vsCheck = spawnSync(
      vswhere,
      [
        '-latest',
        '-products',
        '*',
        '-requires',
        'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property',
        'installationPath',
      ],
      { cwd: desktopRoot, encoding: 'utf8' },
    )
    return vsCheck.status === 0 && Boolean(vsCheck.stdout?.trim())
  }

  return false
}

if (process.platform === 'darwin') {
  const patchStatus = run('bash', ['scripts/patch-electron-dev.sh'])
  if (patchStatus !== 0) process.exit(patchStatus)
}

ensureElectronInstalled()

if (process.platform === 'win32' && !hasWindowsCppToolchain()) {
  console.warn(
    '[postinstall] Skipping electron-rebuild on Windows: Visual Studio C++ build tools were not detected.',
  )
  console.warn(
    '[postinstall] Install "Visual Studio Build Tools 2022" with Desktop development with C++ to enable native rebuilds (node-pty).',
  )
  process.exit(0)
}

const rebuildStatus =
  process.platform === 'win32'
    ? run('cmd.exe', ['/d', '/s', '/c', 'bunx electron-rebuild'])
    : run('bunx', ['electron-rebuild'])

if (process.platform === 'win32' && rebuildStatus !== 0) {
  console.warn(
    '[postinstall] electron-rebuild failed on Windows. This usually means Visual Studio C++ build tools are not installed yet.',
  )
  console.warn(
    '[postinstall] Continuing install. After installing Build Tools, rerun `bun run --cwd desktop postinstall` if terminal features do not work.',
  )
  process.exit(0)
}

process.exit(rebuildStatus)
