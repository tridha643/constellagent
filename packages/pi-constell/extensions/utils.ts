import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const DEFAULT_NOTIFY_DIR = '/tmp/constellagent-notify'
const PLAN_DIR = '.pi-constell/plans'
const GENERIC_TITLES = new Set(['plan', 'implementation plan', 'pi constell plan', 'pi constell plan mode'])
const FILLER_PREFIXES = [
  /^please\s+/i,
  /^can you\s+/i,
  /^could you\s+/i,
  /^help me\s+/i,
  /^i want to\s+/i,
  /^i(?:'d| would)? like to\s+/i,
  /^we want to\s+/i,
  /^we(?:'d| would)? like to\s+/i,
  /^we need to\s+/i,
  /^need to\s+/i,
  /^for\s+the\s+/i,
  /^for\s+/i,
  /^(?:as|i as)\s+the\s+user\s+/i,
  /^the goal is to\s+/i,
  /^create a plan for\s+/i,
  /^plan for\s+/i,
]
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'be', 'basically', 'by', 'exactly', 'for', 'from', 'how', 'in', 'into', 'just', 'of', 'on', 'or', 'our', 'the', 'their', 'this', 'to', 'we', 'with', 'would', 'your', 'want', 'wants', 'idea',
  'ability', 'able', 'also', 'current', 'currently', 'just', 'now', 'part', 'really', 'right', 'same', 'that', 'user', 'users', 'way',
])
const PREFERRED_VERBS = ['add', 'allow', 'fix', 'improve', 'implement', 'move', 'publish', 'refactor', 'remove', 'support', 'toggle', 'update']
const STRUCTURAL_VERBS = new Set(['change', 'modify', 'update'])
const TITLE_NOISE_PATTERNS = [
  /\bpi[-\s]?constell(?:-plan)?\b/gi,
  /\bconstellagent\b/gi,
  /\bclaude\s+code\b/gi,
  /\bcursor\s+cli\b/gi,
  /\bcodex\s+cli\b/gi,
  /\bask\s*user\s*question\b/gi,
  /\baskuserquestion\b/gi,
  /\blike how\b.*$/i,
  /\bsimilar to\b.*$/i,
  /\bthat is\b.*$/i,
  /\bwhich is\b.*$/i,
]

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
  /^\s*pi\s+(?:-h|--help)\b/i,
  /^\s*pi\s+help(?:\s+\S+)?\b/i,
  /^\s*pi\s+\/help\b/i,
  /^\s*pi\s+\/(?:plan|plan-save|plan-off|agent)\s+--help\b/i,
  /^\s*node\s+--version/i,
  /^\s*python\s+--version/i,
  /^\s*jq\b/,
  /^\s*sed\s+-n/i,
  /^\s*awk\b/,
  /^\s*rg\b/,
  /^\s*fd\b/,
]

const STRONG_PLAN_PATTERNS = [
  /\bplan\b/i,
  /\bphases?\b/i,
  /\broadmap\b/i,
  /\bstrategy\b/i,
  /\bapproach\b/i,
  /\bproposal\b/i,
  /\bdesign\s+doc\b/i,
]

const ARCHITECTURE_PATTERNS = [
  /\barchitecture\b/i,
  /\brefactor\b/i,
  /\bmigration\b/i,
  /\boverhaul\b/i,
  /\brewrite\b/i,
  /\bredesign\b/i,
  /\bre-architect\b/i,
  /\bworkflow\b/i,
  /\bcontract\b/i,
]

const COMPLEXITY_PATTERNS = [
  /\bmulti[-\s]?step\b/i,
  /\bstep[-\s]?by[-\s]?step\b/i,
  /\bbreak\s+down\b/i,
  /\btrade[-\s]?offs?\b/i,
  /\bcompare\b/i,
  /\boptions?\b/i,
  /\bambiguous\b/i,
  /\bexplore\b/i,
  /\bconsent\b/i,
  /\bstate\s+restore\b/i,
  /\bruntime\b/i,
]

const SCOPE_PATTERNS = [
  /\bacross\b/i,
  /\bthroughout\b/i,
  /\bend-to-end\b/i,
  /\bsystem-wide\b/i,
  /\bwhole\s+repo\b/i,
  /\bentire\s+codebase\b/i,
  /\bmultiple\s+(?:files|packages|steps|areas|components)\b/i,
  /\bseveral\s+(?:files|packages|areas|components)\b/i,
]

const SMALL_DIRECT_EDIT_PATTERNS = [
  /\bfix\s+(?:a\s+)?typo\b/i,
  /\brename\b.{0,24}\b(variable|prop|field|class|function|type)\b/i,
  /\bupdate\b.{0,24}\b(?:readme|docs?|comment|copy|string|snapshot)\b/i,
  /\bsmall\b.{0,24}\b(?:edit|fix|change|cleanup|refactor)\b/i,
  /\bminor\b.{0,24}\b(?:edit|fix|change|cleanup|refactor)\b/i,
  /\bsingle\s+(?:file|line|component|function|test)\b/i,
  /\bone[-\s]?line\b/i,
  /\bstraightforward\b/i,
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

export function shouldSuggestPlanModeSwitch(prompt: string | null | undefined): boolean {
  const normalized = prompt?.trim()
  if (!normalized) return false

  let score = 0
  if (STRONG_PLAN_PATTERNS.some((pattern) => pattern.test(normalized))) score += 3
  if (ARCHITECTURE_PATTERNS.some((pattern) => pattern.test(normalized))) score += 2
  if (COMPLEXITY_PATTERNS.some((pattern) => pattern.test(normalized))) score += 2
  if (SCOPE_PATTERNS.some((pattern) => pattern.test(normalized))) score += 2
  if (/\b(?:and|then|plus|also)\b/i.test(normalized) && /[,;]/.test(normalized)) score += 1
  if (normalized.length >= 120) score += 1

  if (SMALL_DIRECT_EDIT_PATTERNS.some((pattern) => pattern.test(normalized))) score -= 3
  if (/\b(?:quick|tiny|simple)\b/i.test(normalized) && !STRONG_PLAN_PATTERNS.some((pattern) => pattern.test(normalized))) score -= 1

  return score >= 3
}

function stripFrontmatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function stripMarkdownArtifacts(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, (_match, label: string) => (/[/.]/.test(label) ? ' ' : label))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(?:^|\s)(?:\/|\.{1,2}\/)?(?:[\w.-]+\/)+[\w.-]+/g, ' ')
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
  if (/^\s*#{1,6}\s+open questions(?:\s*\/\s*assumptions)?\b/im.test(text) && /^\s*#{1,6}\s+phases\b/im.test(text) && /^\s*#{1,6}\s+recommendation\b/im.test(text)) return true
  if (/^\s*#{1,6}\s+phases\b/im.test(text) && /^\s*#{1,6}\s+recommendation\b/im.test(text)) return true
  if (/\bplan\s*:/i.test(text) && /^\s*1[.)]\s+/m.test(text)) return true
  if (/^\s*1[.)]\s+/m.test(text) && /^\s*2[.)]\s+/m.test(text)) return true
  return false
}

function toTitleCase(text: string): string {
  return text.split(/\s+/).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

function sanitizePhrase(text: string): string {
  let value = normalizeWhitespace(stripMarkdownArtifacts(text).replace(/[`*_#>]/g, ' '))
  for (const prefix of FILLER_PREFIXES) value = value.replace(prefix, '')
  for (const pattern of TITLE_NOISE_PATTERNS) value = value.replace(pattern, ' ')
  return value.replace(/[.?!,:;]+$/g, '').trim()
}

function isGenericTitle(title: string): boolean {
  const normalized = title.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  return GENERIC_TITLES.has(normalized)
}

function candidateWords(text: string): string[] {
  const clauses = sanitizePhrase(text)
    .split(/\s+(?:and|also)\s+|[.;:]+/i)
    .map((clause) => normalizeWhitespace(clause))
    .filter(Boolean)

  const selectedClauses = clauses
    .map((clause) => {
      const words = clause
        .toLowerCase()
        .replace(/[^a-z0-9\s-]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .filter((word) => !STOP_WORDS.has(word))
      return { clause, words, verbIndex: words.findIndex((word) => PREFERRED_VERBS.includes(word)) }
    })
    .filter(({ words }) => words.length > 0)
    .sort((left, right) => {
      const leftScore = left.verbIndex >= 0 ? 1 : 0
      const rightScore = right.verbIndex >= 0 ? 1 : 0
      return rightScore - leftScore
    })
    .slice(0, 2)

  const combined = selectedClauses.flatMap(({ words }) => words)
  const deduped = combined.filter((word, index) => combined.indexOf(word) === index)
  const trimmed = STRUCTURAL_VERBS.has(deduped[0] ?? '') ? deduped.slice(1) : deduped
  return trimmed
}

function titleFromCandidate(text: string | null | undefined): string | null {
  if (!text) return null
  const words = candidateWords(text)
  if (words.length === 0) return null

  const firstVerb = words.findIndex((word) => PREFERRED_VERBS.includes(word))
  const ordered = firstVerb > 0 ? [...words.slice(firstVerb), ...words.slice(0, firstVerb)] : words
  const filtered = ordered.filter((word, index) => index === 0 || !STOP_WORDS.has(word))
  const title = toTitleCase(filtered.slice(0, 8).join(' '))
  return title || null
}

function titleFromPrompt(prompt: string | null | undefined): string | null {
  return titleFromCandidate(prompt)
}

function titleFromFirstStep(text: string): string | null {
  const step = firstPlanStep(text)
  if (!step) return null
  return titleFromCandidate(step)
}

function firstSectionListItem(text: string, sectionNames: string[]): string | null {
  const sectionSet = new Set(sectionNames.map((name) => name.toLowerCase()))
  let inSection = false

  for (const rawLine of text.split(/\r?\n/)) {
    const heading = rawLine.match(/^\s*#{1,6}\s+(.+?)\s*$/)
    if (heading) {
      inSection = sectionSet.has(heading[1].trim().toLowerCase())
      continue
    }
    if (!inSection) continue
    const item = rawLine.match(/^\s*(?:[-*]|\d+[.)])\s+(.+?)\s*$/)
    if (item) return item[1].trim()
  }

  return null
}

export function derivePlanTitle(rawText: string, context: PlanNamingContext = {}): string {
  const cleaned = stripFrontmatter(rawText)
  const heading = firstHeading(cleaned)
  if (heading && !isGenericTitle(heading)) return normalizeWhitespace(heading)

  const contextual = titleFromPrompt(context.clarifications) || titleFromPrompt(context.prompt)
  if (contextual) return contextual

  const implementationItem = firstSectionListItem(cleaned, ['Implementation', 'Plan'])
  const implementationTitle = titleFromCandidate(implementationItem)
  if (implementationTitle) return implementationTitle

  const goalItem = firstSectionListItem(cleaned, ['Goal', 'Goals'])
  const goalTitle = titleFromCandidate(goalItem)
  if (goalTitle) return goalTitle

  const firstStepTitle = titleFromFirstStep(cleaned)
  if (firstStepTitle) return firstStepTitle

  return 'Working Plan'
}

export function slugifyPlanTitle(title: string): string {
  const tokens = candidateWords(title)
  const firstVerb = tokens.findIndex((token) => PREFERRED_VERBS.includes(token))
  const ordered = firstVerb > 0 ? [...tokens.slice(firstVerb), ...tokens.slice(0, firstVerb)] : tokens
  const filtered = ordered.filter((token, index) => index === 0 || !STOP_WORDS.has(token))
  const slug = filtered.slice(0, 8).join('-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return slug || 'working-plan'
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

export function getPlanDir(): string {
  return join(homedir(), PLAN_DIR)
}

export async function allocatePlanPath(_cwd: string, title: string, currentPath?: string | null): Promise<string> {
  const planDir = getPlanDir()
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
  const title = titleFromPrompt(context.clarifications) || titleFromPrompt(context.prompt) || 'Working Plan'
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
