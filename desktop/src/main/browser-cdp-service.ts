import type { WebContents } from 'electron'
import { existsSync } from 'fs'
import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import WebSocket from 'ws'
import type {
  BrowserContextEvent,
  BrowserContextStatus,
  ComponentMutationContext,
  SelectedComponentContext,
} from '../shared/browser-context-types'
import { IPC } from '../shared/ipc-channels'

interface CdpTarget {
  id: string
  type: string
  title?: string
  url?: string
  webSocketDebuggerUrl?: string
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

const INSPECTOR_SCRIPT = String.raw`
(() => {
  if (window.__constellagentBrowserInspector) return 'already-installed';
  const state = {
    inspect: false,
    edit: false,
    selected: null,
    selectedContext: null,
    beforeMutation: null,
    drag: null,
    resize: null,
    debounce: 0,
  };
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #4f8cff;background:rgba(79,140,255,.12);display:none;box-sizing:border-box;';
  const selectedOverlay = document.createElement('div');
  selectedOverlay.style.cssText = 'position:fixed;z-index:2147483647;display:none;border:2px solid #ffb020;background:rgba(255,176,32,.10);box-sizing:border-box;cursor:move;';
  const handle = document.createElement('div');
  handle.style.cssText = 'position:absolute;right:-6px;bottom:-6px;width:12px;height:12px;background:#ffb020;border:2px solid #111;border-radius:2px;cursor:nwse-resize;pointer-events:auto;';
  selectedOverlay.appendChild(handle);
  document.documentElement.append(overlay, selectedOverlay);

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }
  function positionBox(box, r) {
    box.style.left = r.x + 'px';
    box.style.top = r.y + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
  }
  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 8) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        part += '#' + CSS.escape(node.id);
        parts.unshift(part);
        break;
      }
      const cls = Array.from(node.classList || []).slice(0, 2).map((c) => '.' + CSS.escape(c)).join('');
      part += cls;
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }
  function attrs(el) {
    const out = {};
    for (const attr of Array.from(el.attributes || [])) out[attr.name] = attr.value;
    return out;
  }
  function agentMeta(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      const d = node.dataset || {};
      if (d.agentSourceFile || d.agentSourceLine || d.agentComponent) {
        return {
          file: d.agentSourceFile,
          line: d.agentSourceLine ? Number(d.agentSourceLine) : undefined,
          column: d.agentSourceColumn ? Number(d.agentSourceColumn) : undefined,
          component: d.agentComponent,
        };
      }
      node = node.parentElement;
    }
    return {};
  }
  function nearby(el) {
    const parent = el.parentElement;
    if (!parent) return [];
    return Array.from(parent.children).filter((child) => child !== el).slice(0, 4).map((child) => (child.innerText || child.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 4);
  }
  function snapshot(el) {
    return {
      kind: 'browser-selected-component',
      url: location.href,
      title: document.title,
      tag: el.tagName,
      text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 2000),
      id: el.id || undefined,
      className: typeof el.className === 'string' ? el.className : undefined,
      role: el.getAttribute('role') || undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
      domPath: cssPath(el),
      attributes: attrs(el),
      boundingBox: rectOf(el),
      nearbyText: nearby(el),
      agentMetadata: agentMeta(el),
      timestamp: Date.now(),
    };
  }
  function emit(payload) {
    try { window.constellagentBrowserContext(JSON.stringify(payload)); } catch {}
  }
  function showSelected() {
    if (!state.selected) {
      selectedOverlay.style.display = 'none';
      return;
    }
    positionBox(selectedOverlay, rectOf(state.selected));
    selectedOverlay.style.display = 'block';
    selectedOverlay.style.pointerEvents = state.edit ? 'auto' : 'none';
  }
  function select(el) {
    state.selected = el;
    state.selectedContext = snapshot(el);
    showSelected();
    emit({ type: 'selected', component: state.selectedContext });
  }
  function mutation(type, before, changed, delta) {
    if (!state.selected || !before) return;
    const after = snapshot(state.selected);
    state.selectedContext = after;
    showSelected();
    const payload = {
      kind: 'browser-component-mutation',
      mutationType: type,
      before,
      after,
      changedCssProperties: changed,
      boundingBoxBefore: before.boundingBox,
      boundingBoxAfter: after.boundingBox,
      generatedDelta: delta,
      timestamp: Date.now(),
    };
    clearTimeout(state.debounce);
    state.debounce = setTimeout(() => emit({ type: 'mutation', mutation: payload }), 500);
  }
  document.addEventListener('mousemove', (event) => {
    if (!state.inspect) return;
    const el = event.target;
    if (!(el instanceof Element) || el === overlay || el === selectedOverlay || el === handle) return;
    positionBox(overlay, rectOf(el));
    overlay.style.display = 'block';
  }, true);
  document.addEventListener('click', (event) => {
    if (!state.inspect) return;
    const el = event.target;
    if (!(el instanceof Element) || el === selectedOverlay || el === handle) return;
    event.preventDefault();
    event.stopPropagation();
    select(el);
  }, true);
  selectedOverlay.addEventListener('pointerdown', (event) => {
    if (!state.edit || !state.selected || event.target === handle) return;
    event.preventDefault();
    selectedOverlay.setPointerCapture(event.pointerId);
    state.drag = { x: event.clientX, y: event.clientY, before: snapshot(state.selected), base: state.selected.style.transform || '' };
  });
  handle.addEventListener('pointerdown', (event) => {
    if (!state.edit || !state.selected) return;
    event.preventDefault();
    event.stopPropagation();
    selectedOverlay.setPointerCapture(event.pointerId);
    const r = rectOf(state.selected);
    state.resize = { x: event.clientX, y: event.clientY, w: r.width, h: r.height, before: snapshot(state.selected) };
  });
  selectedOverlay.addEventListener('pointermove', (event) => {
    if (!state.selected) return;
    if (state.drag) {
      const dx = Math.round(event.clientX - state.drag.x);
      const dy = Math.round(event.clientY - state.drag.y);
      state.selected.style.transform = (state.drag.base ? state.drag.base + ' ' : '') + 'translate(' + dx + 'px, ' + dy + 'px)';
      showSelected();
      mutation('move', state.drag.before, { transform: state.selected.style.transform }, 'inline style transform: ' + state.selected.style.transform);
    }
    if (state.resize) {
      const w = Math.max(1, Math.round(state.resize.w + event.clientX - state.resize.x));
      const h = Math.max(1, Math.round(state.resize.h + event.clientY - state.resize.y));
      state.selected.style.width = w + 'px';
      state.selected.style.height = h + 'px';
      showSelected();
      mutation('resize', state.resize.before, { width: state.selected.style.width, height: state.selected.style.height }, 'inline style width/height: ' + w + 'px / ' + h + 'px');
    }
  });
  selectedOverlay.addEventListener('pointerup', () => { state.drag = null; state.resize = null; });
  window.__constellagentBrowserInspector = {
    setInspect(value) { state.inspect = !!value; overlay.style.display = state.inspect ? overlay.style.display : 'none'; },
    setEdit(value) { state.edit = !!value; showSelected(); },
    clear() { state.selected = null; state.selectedContext = null; selectedOverlay.style.display = 'none'; },
    applyStyle(prop, value) {
      if (!state.selected) return false;
      const before = snapshot(state.selected);
      state.selected.style[prop] = value;
      mutation('style', before, { [prop]: value }, 'inline style ' + prop + ': ' + value);
      return true;
    }
  };
  return 'installed';
})();
`

export class BrowserCdpService {
  private ws: WebSocket | null = null
  private browserProcess: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, PendingCall>()
  private sender: WebContents | null = null
  private status: BrowserContextStatus = {
    enabled: process.env.CONSTELLAGENT_CDP_ENABLED !== 'false',
    connected: false,
    port: Number(process.env.CONSTELLAGENT_CDP_PORT || 9222),
  }

  getStatus(): BrowserContextStatus {
    return { ...this.status }
  }

  async connect(sender: WebContents): Promise<BrowserContextStatus> {
    this.sender = sender
    if (!this.status.enabled) {
      this.status = { ...this.status, connected: false, error: 'Browser context is disabled by CONSTELLAGENT_CDP_ENABLED=false.' }
      return this.getStatus()
    }
    let targets: CdpTarget[]
    try {
      targets = await this.fetchTargetsWithLaunch()
    } catch (err) {
      this.disconnect()
      this.status = {
        ...this.status,
        connected: false,
        error: this.connectionErrorMessage(err),
      }
      return this.getStatus()
    }
    const target = targets.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl)
    if (!target?.webSocketDebuggerUrl) {
      this.disconnect()
      this.status = {
        ...this.status,
        connected: false,
        error: `No Chromium page target found on CDP port ${this.status.port}. Open a browser page with remote debugging enabled.`,
      }
      return this.getStatus()
    }
    this.disconnect()
    try {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(target.webSocketDebuggerUrl!)
        this.ws = ws
        ws.on('open', () => resolve())
        ws.on('error', (err) => reject(err))
        ws.on('message', (data) => this.handleMessage(String(data)))
        ws.on('close', () => {
          this.status = { ...this.status, connected: false }
          this.ws = null
        })
      })
    } catch (err) {
      this.disconnect()
      this.status = {
        ...this.status,
        connected: false,
        error: this.connectionErrorMessage(err),
      }
      return this.getStatus()
    }
    this.status = { enabled: true, connected: true, port: this.status.port, targetUrl: target.url }
    try {
      await this.call('Runtime.enable')
      await this.call('Runtime.addBinding', { name: 'constellagentBrowserContext' })
      await this.call('Runtime.evaluate', { expression: INSPECTOR_SCRIPT, awaitPromise: false })
    } catch (err) {
      this.disconnect()
      this.status = {
        ...this.status,
        connected: false,
        error: this.connectionErrorMessage(err),
      }
    }
    return this.getStatus()
  }

  disconnect(): void {
    if (this.ws) this.ws.close()
    this.ws = null
    this.pending.clear()
    this.status = { ...this.status, connected: false }
  }

  shutdown(): void {
    this.disconnect()
    if (this.browserProcess && !this.browserProcess.killed) {
      this.browserProcess.kill()
    }
    this.browserProcess = null
  }

  async setInspect(enabled: boolean): Promise<void> {
    await this.evaluate(`window.__constellagentBrowserInspector?.setInspect(${JSON.stringify(enabled)})`)
  }

  async setEdit(enabled: boolean): Promise<void> {
    await this.evaluate(`window.__constellagentBrowserInspector?.setEdit(${JSON.stringify(enabled)})`)
  }

  async clear(): Promise<void> {
    await this.evaluate('window.__constellagentBrowserInspector?.clear()')
  }

  async applyStyle(property: string, value: string): Promise<void> {
    if (!/^(color|backgroundColor|borderColor|borderWidth|borderStyle|borderRadius)$/.test(property)) {
      throw new Error('Unsupported style property')
    }
    await this.evaluate(`window.__constellagentBrowserInspector?.applyStyle(${JSON.stringify(property)}, ${JSON.stringify(value)})`)
  }

  private async evaluate(expression: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('Browser is not connected')
    await this.call('Runtime.evaluate', { expression, awaitPromise: false })
  }

  private async fetchTargets(): Promise<CdpTarget[]> {
    const res = await fetch(`http://127.0.0.1:${this.status.port}/json`)
    if (!res.ok) throw new Error(`CDP HTTP ${res.status}`)
    return await res.json() as CdpTarget[]
  }

  private async fetchTargetsWithLaunch(): Promise<CdpTarget[]> {
    try {
      return await this.fetchTargets()
    } catch (err) {
      if (!this.isConnectionRefused(err)) throw err
    }
    this.launchBrowser()
    const deadline = Date.now() + 8_000
    let lastError: unknown = null
    while (Date.now() < deadline) {
      try {
        const targets = await this.fetchTargets()
        if (targets.length > 0) return targets
      } catch (err) {
        lastError = err
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for Chromium on CDP port ${this.status.port}`)
  }

  private launchBrowser(): void {
    if (this.browserProcess && !this.browserProcess.killed) return
    const executable = process.env.CONSTELLAGENT_BROWSER_EXECUTABLE || this.findChromiumExecutable()
    if (!executable) {
      throw new Error('Could not find Chrome, Edge, or Chromium. Set CONSTELLAGENT_BROWSER_EXECUTABLE to a Chromium executable path.')
    }
    if (!existsSync(executable)) {
      throw new Error(`Chromium executable not found: ${executable}`)
    }
    const userDataDir = process.env.CONSTELLAGENT_BROWSER_USER_DATA_DIR || join(process.cwd(), '.git', 'constellagent-browser-profile')
    const startUrl = process.env.CONSTELLAGENT_BROWSER_URL || 'about:blank'
    this.browserProcess = spawn(executable, [
      `--remote-debugging-port=${this.status.port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      startUrl,
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    this.browserProcess.unref()
    this.browserProcess.once('exit', () => {
      this.browserProcess = null
      this.status = { ...this.status, connected: false }
    })
  }

  private findChromiumExecutable(): string | null {
    const candidates = process.platform === 'win32'
      ? [
          join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/microsoft-edge',
          ]
    return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null
  }

  private isConnectionRefused(err: unknown): boolean {
    const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: unknown }).code) : undefined
    const cause = typeof err === 'object' && err && 'cause' in err ? (err as { cause?: unknown }).cause : undefined
    const causeCode = typeof cause === 'object' && cause && 'code' in cause ? String((cause as { code?: unknown }).code) : undefined
    return code === 'ECONNREFUSED' || causeCode === 'ECONNREFUSED'
  }

  private connectionErrorMessage(err: unknown): string {
    if (this.isConnectionRefused(err)) {
      return `Could not connect to Chromium on 127.0.0.1:${this.status.port}. Press Open Browser again or set CONSTELLAGENT_BROWSER_EXECUTABLE to a Chromium executable path.`
    }
    const message = err instanceof Error ? err.message : 'Failed to connect browser'
    return `Browser connection failed: ${message}`
  }

  private call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('Browser is not connected')
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        reject(new Error(`CDP call timed out: ${method}`))
      }, 10_000)
    })
  }

  private handleMessage(raw: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)))
      else pending.resolve(message.result)
      return
    }
    if (message.method !== 'Runtime.bindingCalled') return
    const params = message.params as { name?: string; payload?: string } | undefined
    if (params?.name !== 'constellagentBrowserContext' || !params.payload) return
    try {
      const payload = JSON.parse(params.payload) as BrowserContextEvent
      if (payload.type === 'selected') {
        this.emit({ type: 'selected', component: payload.component as SelectedComponentContext })
      } else if (payload.type === 'mutation') {
        this.emit({ type: 'mutation', mutation: payload.mutation as ComponentMutationContext })
      }
    } catch {
      // Ignore malformed page payloads.
    }
  }

  private emit(event: BrowserContextEvent): void {
    const sender = this.sender
    if (!sender || sender.isDestroyed()) return
    sender.send(IPC.BROWSER_CONTEXT_EVENT, event)
  }
}

export const browserCdpService = new BrowserCdpService()
