/**
 * Injects the bundled Agentation guest script into a webview page.
 */
export function buildAgentationInjectScript(endpoint: string, guestScriptUrl: string): string {
  const ep = JSON.stringify(endpoint)
  const src = JSON.stringify(guestScriptUrl)
  return `(async function () {
  window.__CONSTELLAGENT_AGENTATION_ENDPOINT__ = ${ep};
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
