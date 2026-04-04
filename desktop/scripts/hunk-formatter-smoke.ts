import { formatReviewForAgent } from '../src/renderer/utils/review-formatter'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`)
}

function pass(label: string): void {
  console.log(`  ✓ ${label}`)
}

console.log('[hunk-formatter-smoke]')

// Empty comments
assert(formatReviewForAgent([]) === '', 'empty array should return empty string')
pass('empty input returns empty string')

// Single comment with newLine
const single = formatReviewForAgent([
  { id: 'c1', file: 'src/index.ts', newLine: 42, summary: 'Fix the typo' },
])
assert(single.includes('[Code Review Feedback]'), 'should include header')
assert(single.includes('## src/index.ts (line 42, new)'), 'should format file + line + side')
assert(single.includes('Fix the typo'), 'should include summary')
assert(single.includes('Please address these review comments.'), 'should include footer')
pass('single comment with newLine formats correctly')

// Comment with oldLine only
const oldSide = formatReviewForAgent([
  { id: 'c2', file: 'lib.ts', oldLine: 10, summary: 'Removed important code' },
])
assert(oldSide.includes('## lib.ts (line 10, old)'), 'should use old side when only oldLine present')
pass('comment with oldLine uses old side')

// Comment with neither line
const noLine = formatReviewForAgent([
  { id: 'c3', file: 'README.md', summary: 'General feedback' },
])
assert(noLine.includes('(line 0, old)'), 'should fall back to line 0 old')
pass('comment with no lines falls back to 0')

// Multiple comments
const multi = formatReviewForAgent([
  { id: 'c4', file: 'a.ts', newLine: 1, summary: 'First' },
  { id: 'c5', file: 'b.ts', newLine: 2, summary: 'Second' },
  { id: 'c6', file: 'c.ts', oldLine: 3, summary: 'Third' },
])
assert(multi.includes('## a.ts'), 'should include first file')
assert(multi.includes('## b.ts'), 'should include second file')
assert(multi.includes('## c.ts'), 'should include third file')
pass('multiple comments all appear in output')

// Verify newLine takes precedence over oldLine
const both = formatReviewForAgent([
  { id: 'c7', file: 'x.ts', newLine: 5, oldLine: 3, summary: 'Both lines' },
])
assert(both.includes('(line 5, new)'), 'newLine should take precedence')
pass('newLine takes precedence when both present')

console.log('\n[hunk-formatter-smoke] all passed ✓')
