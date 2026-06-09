/**
 * Injects the bundled Agentation guest script into a webview page.
 */
export function buildAgentationInjectScript(
  endpoint: string,
  guestScriptUrl: string,
  sessionId?: string,
): string {
  const ep = JSON.stringify(endpoint)
  const src = JSON.stringify(guestScriptUrl)
  const sid = sessionId ? JSON.stringify(sessionId) : 'undefined'
  return `(async function () {
  window.__CONSTELLAGENT_AGENTATION_ENDPOINT__ = ${ep};
  window.__CONSTELLAGENT_AGENTATION_SESSION_ID__ = ${sid};
  document
    .querySelectorAll('meta[http-equiv="Content-Security-Policy" i], meta[http-equiv="Content-Security-Policy-Report-Only" i]')
    .forEach(function (el) { el.remove(); });
  if (window.__constellagentAgentationMounted) {
    if (document.getElementById('constellagent-agentation-root')) return;
    window.__constellagentAgentationMounted = false;
  }
  window.__constellagentAgentationMounted = true;
  const s = document.createElement('script');
  s.type = 'module';
  s.src = ${src};
  s.onerror = function () {
    console.error('[constellagent] Failed to load Agentation guest script from', ${src});
    window.__constellagentAgentationMounted = false;
  };
  document.head.appendChild(s);
})();`
}
