import { open, readFile as fsReadFile, writeFile as fsWriteFile } from 'fs/promises'
import yaml from 'js-yaml'
import type { PlanAgent, PlanMeta } from '../shared/agent-plan-path'
import { PLAN_META_DEFAULTS } from '../shared/agent-plan-path'

const PLAN_AGENT_KEYS = new Set<PlanAgent>(['cursor', 'claude-code', 'codex', 'gemini'])

function parsePlanAgent(v: unknown): PlanAgent | null {
  if (typeof v !== 'string') return null
  return PLAN_AGENT_KEYS.has(v as PlanAgent) ? (v as PlanAgent) : null
}

const FM_OPEN = '---'
const FM_CLOSE = '---'
const PREFIX_BYTES = 16 * 1024

interface ParsedFile {
  frontmatter: Record<string, unknown> | null
  body: string
  /** Raw frontmatter string (without delimiters) — preserved for roundtrip fidelity. */
  rawFm: string | null
}

function splitFrontmatter(content: string): ParsedFile {
  if (!content.startsWith(FM_OPEN + '\n') && !content.startsWith(FM_OPEN + '\r\n')) {
    return { frontmatter: null, body: content, rawFm: null }
  }
  const closeIdx = content.indexOf('\n' + FM_CLOSE, FM_OPEN.length)
  if (closeIdx < 0) return { frontmatter: null, body: content, rawFm: null }

  const fmEnd = closeIdx + 1 + FM_CLOSE.length
  const rawFm = content.slice(FM_OPEN.length + 1, closeIdx)
  let bodyStart = fmEnd
  if (content[bodyStart] === '\n') bodyStart++
  else if (content[bodyStart] === '\r' && content[bodyStart + 1] === '\n') bodyStart += 2

  try {
    const parsed = yaml.load(rawFm)
    const fm = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
    return { frontmatter: fm, body: content.slice(bodyStart), rawFm }
  } catch {
    return { frontmatter: null, body: content, rawFm: null }
  }
}

function assembleFrontmatter(fm: Record<string, unknown>, body: string): string {
  const fmStr = yaml.dump(fm, { lineWidth: -1, sortKeys: false }).trimEnd()
  return `${FM_OPEN}\n${fmStr}\n${FM_CLOSE}\n${body}`
}

/** Extract PlanMeta from frontmatter object (or defaults). */
function extractMeta(fm: Record<string, unknown> | null): PlanMeta {
  if (!fm || typeof fm.constellagent !== 'object' || fm.constellagent === null) {
    return { ...PLAN_META_DEFAULTS }
  }
  const c = fm.constellagent as Record<string, unknown>
  return {
    built: typeof c.built === 'boolean' ? c.built : PLAN_META_DEFAULTS.built,
    codingAgent: typeof c.codingAgent === 'string' ? c.codingAgent : PLAN_META_DEFAULTS.codingAgent,
    buildHarness: parsePlanAgent(c.buildHarness) ?? PLAN_META_DEFAULTS.buildHarness,
  }
}

/**
 * Read only the leading bytes of a plan file and extract PlanMeta.
 * Falls back gracefully if the file has no frontmatter.
 */
export async function readPlanMetaPrefix(filePath: string): Promise<PlanMeta> {
  let fd
  try {
    fd = await open(filePath, 'r')
    const buf = Buffer.alloc(PREFIX_BYTES)
    const { bytesRead } = await fd.read(buf, 0, PREFIX_BYTES, 0)
    const prefix = buf.toString('utf-8', 0, bytesRead)
    const { frontmatter } = splitFrontmatter(prefix)
    return extractMeta(frontmatter)
  } catch {
    return { ...PLAN_META_DEFAULTS }
  } finally {
    await fd?.close()
  }
}

/** Read full PlanMeta from a plan file. */
export async function readPlanMeta(filePath: string): Promise<PlanMeta> {
  try {
    const content = await fsReadFile(filePath, 'utf-8')
    const { frontmatter } = splitFrontmatter(content)
    return extractMeta(frontmatter)
  } catch {
    return { ...PLAN_META_DEFAULTS }
  }
}

/**
 * Merge a partial PlanMeta update into the file's frontmatter.
 * Preserves all non-constellagent keys and the markdown body.
 */
export async function writePlanMeta(
  filePath: string,
  patch: Partial<PlanMeta>,
): Promise<PlanMeta> {
  const content = await fsReadFile(filePath, 'utf-8')
  const { frontmatter, body } = splitFrontmatter(content)
  const fm: Record<string, unknown> = frontmatter ?? {}

  const existing =
    typeof fm.constellagent === 'object' && fm.constellagent !== null
      ? { ...(fm.constellagent as Record<string, unknown>) }
      : {}

  if (patch.built !== undefined) existing.built = patch.built
  if (patch.codingAgent !== undefined) existing.codingAgent = patch.codingAgent
  if (patch.buildHarness !== undefined) existing.buildHarness = patch.buildHarness

  fm.constellagent = existing
  const newContent = assembleFrontmatter(fm, body)
  await fsWriteFile(filePath, newContent, 'utf-8')
  return extractMeta(fm)
}
