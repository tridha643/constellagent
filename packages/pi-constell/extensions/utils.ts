import { access, lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

const DEFAULT_NOTIFY_DIR = '/tmp/constellagent-notify'
const PLAN_DIR = '.pi-constell/plans'
const PLAN_EXCLUDE_COMMENT = '# pi-constell-plan local-only plans'
const PLAN_EXCLUDE_ENTRY = `${PLAN_DIR}/`
const GENERIC_TITLES = new Set(['plan', 'implementation plan', 'pi constell plan', 'pi constell plan mode'])
const FILLER_PREFIXES = [
  /^please\s+/i,
  /^can you\s+/i,
  /^could you\s+/i,
  /^help me\s+/i,
  /^i want to\s+/i,
  /^we want to\s+/i,
  /^create a plan for\s+/i,
  /^plan for\s+/i,
]
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'be', 'basically', 'by', 'exactly', 'for', 'from', 'how', 'in', 'into', 'just', 'of', 'on', 'or', 'our', 'the', 'their', 'this', 'to', 'we', 'with', 'would', 'your', 'want', 'wants', 'idea',
])
const PREFERRED_VERBS = ['add', 'improve', 'fix', 'publish', 'refactor', 'support', 'implement', 'update']

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

export interface PlanNamingContext {
  prompt?: string | null
  clarifications?: string | null
}

export function isSafeCommand(command: string): boolean {
  const isDestructive = DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command))
  const isSafe = SAFE_PATTERNS.some((pattern) => pattern.test(command))
  return !isDestructive && isSafe
}

function stripFrontmatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function firstHeading(text: string): string | null {
  const match = text.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim() || null
}

function firstPlanStep(text: string): string | null {
  const match = text.match(/^\s*1[.)]\s+(.+)$/m)
  return match?.[1]?.trim() || null
}

function hasPlanShape(text: string): boolean {
  if (/^\s*#{1,6}\s+plan\b/im.test(text)) return true
  if (/^\s*#{1,6}\s+goal\b/im.test(text) && /^\s*#{1,6}\s+plan\b/im.test(text)) return true
  if (/^\s*#{1,6}\s+open questions(?:\s*\/\s*assumptions)?\b/im.test(text) && /^\s*#{1,6}\s+proposed pr stack\b/im.test(text)) return true
  if (/\bplan\s*:/i.test(text) && /^\s*1[.)]\s+/m.test(text)) return true
  if (/^\s*1[.)]\s+/m.test(text) && /^\s*2[.)]\s+/m.test(text)) return true
  return false
}

function toTitleCase(text: string): string {
  return text.split(/\s+/).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

function sanitizePhrase(text: string): string {
  let value = normalizeWhitespace(text.replace(/[`*_#>]/g, ' '))
  for (const prefix of FILLER_PREFIXES) value = value.replace(prefix, '')
  return value.replace(/[.?!,:;]+$/g, '').trim()
}

function isGenericTitle(title: string): boolean {
  const normalized = title.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  return GENERIC_TITLES.has(normalized)
}

function titleFromPrompt(prompt: string | null | undefined): string | null {
  if (!prompt) return null
  const sanitized = sanitizePhrase(prompt)
  if (!sanitized) return null
  const words = sanitized
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !STOP_WORDS.has(word))

  if (words.length === 0) return null

  const firstVerb = words.findIndex((word) => PREFERRED_VERBS.includes(word))
  const ordered = firstVerb > 0 ? [...words.slice(firstVerb), ...words.slice(0, firstVerb)] : words
  return toTitleCase(ordered.slice(0, 8).join(' '))
}

function titleFromFirstStep(text: string): string | null {
  const step = firstPlanStep(text)
  if (!step) return null
  return toTitleCase(sanitizePhrase(step).split(/\s+/).slice(0, 8).join(' '))
}

export function derivePlanTitle(rawText: string, context: PlanNamingContext = {}): string {
  const cleaned = stripFrontmatter(rawText)
  const heading = firstHeading(cleaned)
  if (heading && !isGenericTitle(heading)) return normalizeWhitespace(heading)

  const contextual = titleFromPrompt(context.clarifications) || titleFromPrompt(context.prompt)
  if (contextual) return contextual

  const firstStepTitle = titleFromFirstStep(cleaned)
  if (firstStepTitle) return firstStepTitle

  return 'Implementation Plan'
}

export function slugifyPlanTitle(title: string): string {
  const lowered = title.toLowerCase().replace(/[^a-z0-9\s-]+/g, ' ')
  const tokens = lowered.split(/\s+/).filter(Boolean)
  const firstVerb = tokens.findIndex((token) => PREFERRED_VERBS.includes(token))
  const ordered = firstVerb > 0 ? [...tokens.slice(firstVerb), ...tokens.slice(0, firstVerb)] : tokens
  const filtered = ordered.filter((token, index) => index === 0 || !STOP_WORDS.has(token))
  const slug = filtered.slice(0, 8).join('-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return slug || 'implementation-plan'
}

export function buildPlanMarkdown(rawText: string, context: PlanNamingContext = {}): { title: string; markdown: string } | null {
  const cleaned = stripFrontmatter(rawText)
  if (!hasPlanShape(cleaned)) return null

  const title = derivePlanTitle(cleaned, context)
  const heading = firstHeading(cleaned)
  const hasSpecificTitle = Boolean(heading && !isGenericTitle(heading))
  const markdown = hasSpecificTitle ? cleaned : `# ${title}\n\n${cleaned}`
  return { title, markdown: markdown.trim() + '\n' }
}

function buildFrontmatter(modelId: string | null): string {
  return [
    '---',
    'constellagent:',
    '  built: false',
    `  codingAgent: ${modelId ? JSON.stringify(modelId) : 'null'}`,
    '  buildHarness: "pi-constell-plan"',
    '---',
    '',
  ].join('\n')
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export function getPlanDir(cwd: string): string {
  return join(cwd, PLAN_DIR)
}

async function resolveGitDir(cwd: string): Promise<string | null> {
  const dotGitPath = resolve(cwd, '.git')
  try {
    const stats = await lstat(dotGitPath)
    if (stats.isDirectory()) return dotGitPath
    if (!stats.isFile()) return null

    const pointer = await readFile(dotGitPath, 'utf-8')
    const match = pointer.match(/^gitdir:\s*(.+)\s*$/m)
    return match ? resolve(cwd, match[1]) : null
  } catch {
    return null
  }
}

export async function ensurePlanStorageIgnored(cwd: string): Promise<void> {
  const gitDir = await resolveGitDir(cwd)
  if (!gitDir) return

  const infoDir = join(gitDir, 'info')
  const excludePath = join(infoDir, 'exclude')
  await mkdir(infoDir, { recursive: true })

  let content = ''
  try {
    content = await readFile(excludePath, 'utf-8')
  } catch {
    content = ''
  }

  const lines = content.replace(/\r\n/g, '\n').split('\n').map((line) => line.trim())
  if (lines.includes(PLAN_DIR) || lines.includes(PLAN_EXCLUDE_ENTRY)) return

  const prefix = content.trimEnd()
  const next = [prefix, prefix ? '' : null, PLAN_EXCLUDE_COMMENT, PLAN_EXCLUDE_ENTRY, '']
    .filter((line): line is string => line !== null)
    .join('\n')
  await writeFile(excludePath, next, 'utf-8')
}

export async function allocatePlanPath(cwd: string, title: string, currentPath?: string | null): Promise<string> {
  await ensurePlanStorageIgnored(cwd)

  const planDir = getPlanDir(cwd)
  await mkdir(planDir, { recursive: true })

  const slug = slugifyPlanTitle(title)
  const currentBase = currentPath ? basename(currentPath) : null
  if (currentBase === `${slug}.md` || currentBase?.startsWith(`${slug}-`)) return resolve(currentPath!)

  let attempt = 1
  while (true) {
    const suffix = attempt === 1 ? '' : `-${attempt}`
    const candidate = resolve(planDir, `${slug}${suffix}.md`)
    if (candidate === resolve(currentPath ?? '')) return candidate
    if (!(await fileExists(candidate))) return candidate
    attempt += 1
  }
}

export async function ensureActivePlanPath(cwd: string, context: PlanNamingContext, currentPath?: string | null): Promise<string> {
  if (currentPath) return resolve(currentPath)
  const title = titleFromPrompt(context.clarifications) || titleFromPrompt(context.prompt) || 'Implementation Plan'
  return allocatePlanPath(cwd, title)
}

export function resolvePlanToolPath(cwd: string, toolPath: string): string {
  return resolve(cwd, toolPath.replace(/^@/, ''))
}

export async function savePlanFile(
  cwd: string,
  rawText: string,
  modelId: string | null,
  context: PlanNamingContext = {},
  currentPath?: string | null,
): Promise<SavedPlan | null> {
  const built = buildPlanMarkdown(rawText, context)
  if (!built) return null

  const targetPath = await allocatePlanPath(cwd, built.title, currentPath)
  await mkdir(dirname(targetPath), { recursive: true })

  if (currentPath && resolve(currentPath) !== targetPath && (await fileExists(currentPath))) {
    await rename(currentPath, targetPath)
  }

  await writeFile(targetPath, buildFrontmatter(modelId) + built.markdown, 'utf-8')
  return { path: targetPath, title: built.title }
}

export async function readPlanFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return null
  }
}

export async function notifyConstellagent(): Promise<void> {
  const workspaceId = process.env.AGENT_ORCH_WS_ID?.trim()
  const agentType = process.env.AGENT_ORCH_AGENT_TYPE?.trim()
  if (!workspaceId || !agentType || !['pi-constell', 'pi-constell-plan'].includes(agentType)) return

  const notifyDir = process.env.CONSTELLAGENT_NOTIFY_DIR || DEFAULT_NOTIFY_DIR
  await mkdir(notifyDir, { recursive: true })
  const filePath = join(notifyDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
  await writeFile(filePath, `${workspaceId}\n`, 'utf-8')
}
