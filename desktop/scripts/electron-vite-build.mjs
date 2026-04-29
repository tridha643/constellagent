import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const electronViteBinCandidates = process.platform === 'win32'
  ? [
      resolve(__dirname, '../node_modules/.bin/electron-vite.exe'),
      resolve(__dirname, '../node_modules/.bin/electron-vite.cmd'),
      resolve(__dirname, '../node_modules/.bin/electron-vite'),
      resolve(__dirname, '../node_modules/.bin/electron-vite.bunx'),
    ]
  : [resolve(__dirname, '../node_modules/.bin/electron-vite')]
const electronViteBin = electronViteBinCandidates.find((path) => existsSync(path))

if (!electronViteBin) {
  throw new Error(`Unable to locate electron-vite binary. Tried: ${electronViteBinCandidates.join(', ')}`)
}

const IGNORED_LINE_RE =
  /^node_modules\/.+ \(\d+:\d+\): Module level directives cause errors when bundled, "use (?:client|server)" in "node_modules\/.+?" was ignored\.$/

function forwardFiltered(stream, target) {
  let buffer = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!IGNORED_LINE_RE.test(line)) target.write(`${line}\n`)
    }
  })
  stream.on('end', () => {
    if (buffer.length > 0 && !IGNORED_LINE_RE.test(buffer)) {
      target.write(buffer)
    }
  })
}

const child =
  process.platform === 'win32'
    ? electronViteBin.endsWith('.cmd')
      ? spawn('cmd.exe', ['/d', '/s', '/c', `"${electronViteBin}" build`], {
          cwd: resolve(__dirname, '..'),
          env: process.env,
          stdio: ['inherit', 'pipe', 'pipe'],
        })
      : spawn(electronViteBin, ['build'], {
          cwd: resolve(__dirname, '..'),
          env: process.env,
          stdio: ['inherit', 'pipe', 'pipe'],
        })
    : spawn(electronViteBin, ['build'], {
        cwd: resolve(__dirname, '..'),
        env: process.env,
        stdio: ['inherit', 'pipe', 'pipe'],
      })

forwardFiltered(child.stdout, process.stdout)
forwardFiltered(child.stderr, process.stderr)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
