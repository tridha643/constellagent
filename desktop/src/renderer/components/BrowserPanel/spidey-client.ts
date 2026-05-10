/**
 * In-page DOM picker injected into the BrowserPanel webview via `executeJavaScript`.
 * The script installs a hover overlay, captures one click, and emits the picked
 * element's React-aware DOM context back to the host renderer through `console.log`
 * with a `__SPIDEY__:<json>` sentinel — picked up by the webview `console-message`
 * event in BrowserPanel.tsx.
 *
 * No bippy dependency: we read the React fiber off the host node's `__reactFiber$…`
 * key directly. `_debugSource` (added by Babel JSX source transform in dev) yields
 * `file:line:column`. In production builds source resolution falls back to null;
 * displayName still works.
 */
export const SPIDEY_CLIENT_SOURCE = String.raw`
(() => {
  if (window.__spideySenseInstalled) {
    window.__spideySenseStart && window.__spideySenseStart();
    return;
  }
  window.__spideySenseInstalled = true;

  const HOST_ID = '__spidey_sense_overlay__';
  const SENTINEL = '__SPIDEY__:';

  function emit(payload) {
    try { console.log(SENTINEL + JSON.stringify(payload)); } catch (_) {}
  }

  function getFiberKey(node) {
    for (const k in node) {
      if (k.startsWith('__reactFiber$')) return k;
    }
    return null;
  }

  function getFiber(node) {
    const k = getFiberKey(node);
    return k ? node[k] : null;
  }

  function safeDisplayName(fiber) {
    if (!fiber) return null;
    let f = fiber;
    while (f) {
      const t = f.type;
      if (typeof t === 'function' || (t && typeof t === 'object')) {
        const name = (t && (t.displayName || t.name)) || (t && t.render && (t.render.displayName || t.render.name));
        if (name && name !== '_default') return name;
      }
      f = f.return;
      if (!f) break;
    }
    return null;
  }

  function findSource(fiber) {
    let f = fiber;
    while (f) {
      const src = f._debugSource;
      if (src && src.fileName) {
        return { file: src.fileName, line: src.lineNumber || 0, column: src.columnNumber || undefined };
      }
      f = f.return;
    }
    return null;
  }

  function readDomContext(el) {
    const fiber = getFiber(el);
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    const textPreview = text.length > 80 ? text.slice(0, 80) + '…' : text;
    const cls = (el.className && typeof el.className === 'string') ? el.className.split(/\s+/).filter(Boolean) : [];
    return {
      tagName: el.tagName,
      classes: cls,
      textPreview,
      displayName: safeDisplayName(fiber),
      source: findSource(fiber),
      url: location.href,
    };
  }

  // ---- Overlay ----
  let host = null;
  let outline = null;
  let label = null;
  let active = false;
  let lastTarget = null;

  function ensureHost() {
    if (host) return host;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646';
    outline = document.createElement('div');
    outline.style.cssText = 'position:absolute;border:2px solid #4dabf7;background:rgba(77,171,247,0.12);border-radius:2px;transition:all 60ms ease-out;display:none';
    label = document.createElement('div');
    label.style.cssText = 'position:absolute;background:#1f2937;color:#fff;font:11px/1.4 ui-monospace,Menlo,monospace;padding:2px 6px;border-radius:3px;white-space:nowrap;display:none';
    host.appendChild(outline);
    host.appendChild(label);
    document.documentElement.appendChild(host);
    return host;
  }

  function isOwnNode(n) {
    while (n) {
      if (n.id === HOST_ID) return true;
      n = n.parentNode;
    }
    return false;
  }

  function elementUnder(x, y) {
    const stack = document.elementsFromPoint(x, y);
    for (const e of stack) {
      if (!isOwnNode(e)) return e;
    }
    return null;
  }

  function paint(el) {
    if (!outline || !label) return;
    const r = el.getBoundingClientRect();
    outline.style.display = 'block';
    outline.style.left = r.left + 'px';
    outline.style.top = r.top + 'px';
    outline.style.width = r.width + 'px';
    outline.style.height = r.height + 'px';
    const fiber = getFiber(el);
    const dn = safeDisplayName(fiber);
    label.style.display = 'block';
    label.style.left = r.left + 'px';
    label.style.top = Math.max(0, r.top - 18) + 'px';
    label.textContent = (dn ? '<' + dn + '> ' : '') + el.tagName.toLowerCase();
  }

  function clearPaint() {
    if (outline) outline.style.display = 'none';
    if (label) label.style.display = 'none';
  }

  function onMove(e) {
    if (!active) return;
    const el = elementUnder(e.clientX, e.clientY);
    if (!el || el === lastTarget) return;
    lastTarget = el;
    paint(el);
  }

  function onClick(e) {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    const el = elementUnder(e.clientX, e.clientY);
    if (el) emit({ __spideySense: 'pick', payload: readDomContext(el) });
    stop();
  }

  function onKey(e) {
    if (active && e.key === 'Escape') {
      e.preventDefault();
      emit({ __spideySense: 'cancel' });
      stop();
    }
  }

  function start() {
    ensureHost();
    active = true;
    lastTarget = null;
    document.documentElement.style.cursor = 'crosshair';
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
  }

  function stop() {
    active = false;
    clearPaint();
    document.documentElement.style.cursor = '';
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKey, true);
  }

  window.__spideySenseStart = start;
  window.__spideySenseStop = stop;
  start();
})();
`
