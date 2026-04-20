import { buildGitSnapshotForLinearDraft } from './git-snapshot'
import { runPiPrompt } from './pi-run-prompt'

function stripTerminalNoise(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
    .replace(/\r/g, '')
}

function unwrapFence(text: string): string {
  const trimmed = stripTerminalNoise(text).trim()
  const fenceMatch = trimmed.match(/^```[\w-]*\n([\s\S]*?)\n```$/)
  if (fenceMatch) return fenceMatch[1].trim()
  return trimmed
}

function formatSnapshotForPrompt(s: Awaited<ReturnType<typeof buildGitSnapshotForLinearDraft>>): string {
  const parts: string[] = []
  if (s.recentCommits.trim()) parts.push(`## Recent commit subjects\n${s.recentCommits}`)
  if (s.status.trim()) parts.push(`## Git status\n${s.status}`)
  if (s.stagedSummary.trim()) parts.push(`## Staged diff summary\n${s.stagedSummary}`)
  if (s.unstagedSummary.trim()) parts.push(`## Unstaged diff summary\n${s.unstagedSummary}`)
  return parts.join('\n\n') || '(no local git context)'
}

const MAX_PROJECT_CONTENT_IN_PROMPT = 14_000

/** Builds markdown sections for optional Linear project fields (used in Pi prompts). */
export function formatLinearProjectContextForPrompt(input: {
  projectDescription?: string | null
  projectContentMarkdown?: string | null
}): string {
  const parts: string[] = []
  const d = input.projectDescription?.trim()
  if (d) parts.push(`## Linear project description\n${d}`)
  let c = input.projectContentMarkdown?.trim()
  if (c) {
    if (c.length > MAX_PROJECT_CONTENT_IN_PROMPT) {
      c = `${c.slice(0, MAX_PROJECT_CONTENT_IN_PROMPT)}\n\n…(truncated)`
    }
    parts.push(`## Linear project document (markdown)\n${c}`)
  }
  return parts.join('\n\n')
}

export function parseIssueDraftOutput(raw: string): { title: string; description: string } {
  const text = unwrapFence(raw)
  const lines = text.split(/\r?\n/)
  const first = lines[0]?.trim() ?? ''
  let title = ''
  let bodyStart = 0

  if (/^TITLE:\s*/i.test(first)) {
    title = first.replace(/^TITLE:\s*/i, '').trim()
    bodyStart = 1
    if (lines[bodyStart]?.trim() === '') bodyStart += 1
  } else {
    title = first || 'New issue'
    bodyStart = first ? 1 : 0
  }

  const description = lines.slice(bodyStart).join('\n').trim()
  return { title, description }
}

export class LinearDraftService {
  static async generateIssueDraft(input: {
    projectName: string
    worktreePath: string | null
    projectDescription?: string | null
    projectContentMarkdown?: string | null
    existingTitle?: string | null
    existingDescription?: string | null
  }): Promise<{ title: string; description: string }> {
    const projectName = input.projectName.trim() || 'Project'
    const linearCtx = formatLinearProjectContextForPrompt(input)
    let gitBlock = ''
    if (input.worktreePath?.trim()) {
      const snap = await buildGitSnapshotForLinearDraft(input.worktreePath.trim())
      gitBlock = formatSnapshotForPrompt(snap)
    } else {
      gitBlock = '(no local workspace — describe the work at a high level only)'
    }

    const linearSection = linearCtx
      ? `The following Linear project fields are authoritative when present; do not invent requirements beyond them.\n\n${linearCtx}\n\n`
      : ''

    const existingTitle = input.existingTitle?.trim() ?? ''
    const existingDescription = input.existingDescription?.trim() ?? ''
    const hasExisting = Boolean(existingTitle || existingDescription)

    const enhanceBlock = hasExisting
      ? `The user already started this ticket. Integrate and improve their draft — do not discard their intent.

## Existing title (may be empty)
${existingTitle || '(empty)'}

## Existing description (may be empty)
${existingDescription || '(empty)'}

Add concrete next steps, tasks, and acceptance criteria where helpful. Keep their voice; merge into one coherent issue. If the title is empty, infer one from the description and git context.

`
      : ''

    const bodyInstructions = hasExisting
      ? `${enhanceBlock}Use the git snapshot below when present to ground the ticket.`
      : `Use the git snapshot below when present to ground the ticket in what is actually changing locally. If the snapshot is empty or minimal, infer a sensible title from the project name and typical next steps.`

    const prompt = `You are drafting a Linear issue title and description for the project "${projectName}".

${linearSection}${bodyInstructions}

Do not inspect the repository. Do not request tools. Reply with exactly this shape:
First line: TITLE: <short imperative title>
Blank line
Then the description in markdown (what, why, ${hasExisting ? 'tasks, ' : ''}acceptance hints).

${gitBlock}`

    const stdout = await runPiPrompt(prompt)
    return parseIssueDraftOutput(stdout)
  }

  static async generateProjectUpdateDraft(input: {
    projectName: string
    pastUpdates: string[]
    worktreePath: string | null
    projectDescription?: string | null
    projectContentMarkdown?: string | null
  }): Promise<{ body: string }> {
    const projectName = input.projectName.trim() || 'Project'
    const linearCtx = formatLinearProjectContextForPrompt(input)
    const voice = input.pastUpdates
      .slice(0, 3)
      .map((b, i) => `### Past update ${i + 1}\n${b.trim()}`)
      .join('\n\n')

    let gitBlock = ''
    if (input.worktreePath?.trim()) {
      const snap = await buildGitSnapshotForLinearDraft(input.worktreePath.trim())
      gitBlock = formatSnapshotForPrompt(snap)
    } else {
      gitBlock = '(no local workspace)'
    }

    const linearSection = linearCtx
      ? `Linear project context (authoritative when present; do not invent beyond it):\n${linearCtx}\n\n`
      : ''

    const prompt = `You are writing a short Linear project update body for "${projectName}".

${linearSection}Match the tone and length of the past updates below when they exist. One or two paragraphs, markdown OK.

Past updates for voice reference:
${voice || '(none)'}

Git context:
${gitBlock}

Reply with the update body only — no title, no "TITLE:" line.`

    const stdout = await runPiPrompt(prompt)
    const body = unwrapFence(stdout).trim()
    return { body }
  }
}
