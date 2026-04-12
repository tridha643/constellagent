import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const DEFAULT_NOTIFY_DIR = '/tmp/constellagent-notify'
const PLAN_DIR = '.pi-constell/plans'

const DESTRUCTIVE_PATTERNS = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\btee\b/i,
  /(^|[^<])>(?!>)/,
  />>/,
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
  /\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
  /\byarn\s+(add|remove|install|publish)/i,
  /\bpnpm\s+(add|remove|install|publish)/i,
  /\bpip\s+(install|uninstall)/i,
  /\bsudo\b/i,
  /\bkill\b/i,
  /\bpkill\b/i,
  /\bkillall\b/i,
  /\b(vim?|nano|emacs|code|subl)\b/i,
]

const SAFE_PATTERNS = [
  /^\s*cat\b/,
  /^\s*head\b/,
  /^\s*tail\b/,
  /^\s*less\b/,
  /^\s*more\b/,
  /^\s*grep\b/,
  /^\s*find\b/,
  /^\s*ls\b/,
  /^\s*pwd\b/,
  /^\s*echo\b/,
  /^\s*printf\b/,
  /^\s*wc\b/,
  /^\s*sort\b/,
  /^\s*uniq\b/,
  /^\s*diff\b/,
  /^\s*file\b/,
  /^\s*stat\b/,
  /^\s*du\b/,
  /^\s*df\b/,
  /^\s*tree\b/,
  /^\s*which\b/,
  /^\s*whereis\b/,
  /^\s*type\b/,
  /^\s*env\b/,
  /^\s*printenv\b/,
  /^\s*uname\b/,
  /^\s*whoami\b/,
  /^\s*id\b/,
  /^\s*date\b/,
  /^\s*uptime\b/,
  /^\s*ps\b/,
  /^\s*top\b/,
  /^\s*htop\b/,
  /^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
  /^\s*git\s+ls-/i,
  /^\s*node\s+--version/i,
  /^\s*python\s+--version/i,
  /^\s*jq\b/,
  /^\s*sed\s+-n/i,
  /^\s*awk\b/,
  /^\s*rg\b/,
  /^\s*fd\b/,
]

export interface SavedPlan {
  path: string
  title: string
}

export function isSafeCommand(command: string): boolean {
  const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command))
  const isSafe = SAFE_PATTERNS.some((p) => p.test(command))
  return !isDestructive && isSafe
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return slug || 'pi-constell-plan'
}

function stripFrontmatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
}

function firstHeading(text: string): string | null {
  const match = text.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim() || null
}

function firstPlanStep(text: string): string | null {
  const match = text.match(/^\s*1[.)]\s+(.+)$/m)
  return match?.[1]?.trim() || null
}

function deriveTitle(text: string): string {
  const heading = firstHeading(text)
  if (heading) return heading
  const firstStep = firstPlanStep(text)
  if (firstStep) return firstStep.replace(/[.?!].*$/, '').trim()
  return 'PI Constell Plan'
}

function hasPlanShape(text: string): boolean {
  if (/^\s*#{1,6}\s+plan\b/im.test(text)) return true
  if (/\bplan\s*:/i.test(text) && /^\s*1[.)]\s+/m.test(text)) return true
  if (/^\s*1[.)]\s+/m.test(text) && /^\s*2[.)]\s+/m.test(text)) return true
  return false
}

export function buildPlanMarkdown(rawText: string): { title: string; markdown: string } | null {
  const cleaned = stripFrontmatter(rawText)
  if (!hasPlanShape(cleaned)) return null

  const title = deriveTitle(cleaned)
  const hasTitleHeading = /^#\s+/m.test(cleaned)
  const markdown = hasTitleHeading ? cleaned : `# ${title}\n\n${cleaned}`
  return { title, markdown: markdown.trim() + '\n' }
}

function buildFrontmatter(modelId: string | null): string {
  const lines = [
    '---',
    'constellagent:',
    '  built: false',
    `  codingAgent: ${modelId ? JSON.stringify(modelId) : 'null'}`,
    '  buildHarness: "pi-constell"',
    '---',
    '',
  ]
  return lines.join('\n')
}

export async function savePlanFile(cwd: string, rawText: string, modelId: string | null): Promise<SavedPlan | null> {
  const built = buildPlanMarkdown(rawText)
  if (!built) return null

  const planDir = join(cwd, PLAN_DIR)
  await mkdir(planDir, { recursive: true })

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/g, '_').replace(/Z$/, '')
  const fileName = `${stamp}_${slugify(built.title)}.md`
  const path = join(planDir, fileName)
  const content = buildFrontmatter(modelId) + built.markdown
  await writeFile(path, content, 'utf-8')
  return { path, title: built.title }
}

export async function notifyConstellagent(): Promise<void> {
  const workspaceId = process.env.AGENT_ORCH_WS_ID?.trim()
  const agentType = process.env.AGENT_ORCH_AGENT_TYPE?.trim()
  if (!workspaceId || agentType !== 'pi-constell') return

  const notifyDir = process.env.CONSTELLAGENT_NOTIFY_DIR || DEFAULT_NOTIFY_DIR
  await mkdir(notifyDir, { recursive: true })
  const filePath = join(notifyDir, `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.txt`)
  await writeFile(filePath, `${workspaceId}\n`, 'utf-8')
}
