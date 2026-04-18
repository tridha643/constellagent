import { describe, expect, it } from 'bun:test'
import { formatPlanEditPayload } from './edit-file-formatter'

describe('formatPlanEditPayload', () => {
  it('formats markdown preview selections as file path plus snippet', () => {
    expect(formatPlanEditPayload({
      filePath: '/tmp/preview-plan.md',
      text: '  Alpha  ',
      fallbackMode: 'header-only',
    })).toBe(`[edit_file]\n@/tmp/preview-plan.md\n\n\`\`\`markdown\nAlpha\n\`\`\``)
  })

  it('formats empty markdown preview selections as a header-only payload', () => {
    expect(formatPlanEditPayload({
      filePath: '/tmp/preview-plan.md',
      fallbackMode: 'header-only',
    })).toBe(`[edit_file]\n@/tmp/preview-plan.md`)
  })

  it('keeps source-editor full-file fallback when no selection exists', () => {
    const payload = formatPlanEditPayload({
      filePath: '/tmp/source-plan.md',
      fullText: '# Source plan\n\nAlpha\nBeta',
    })

    expect(payload).toContain('[edit_file]')
    expect(payload).toContain('@/tmp/source-plan.md')
    expect(payload).toContain('```markdown')
    expect(payload).toContain('# Source plan')
    expect(payload).toContain('Alpha')
    expect(payload).toContain('Beta')
  })
})
