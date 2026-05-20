const MAX_SUGGESTIONS = 20
const TOKEN_PATTERN = /(^|[\s([{])\/([A-Za-z0-9:_-]*)$/

function textBeforePosition(lines, cursorLine, cursorCol) {
  const previousLines = lines.slice(0, cursorLine).join('\n')
  const currentPrefix = (lines[cursorLine] ?? '').slice(0, cursorCol)
  return previousLines ? `${previousLines}\n${currentPrefix}` : currentPrefix
}

export function extractInlineSlashToken(lines, cursorLine, cursorCol) {
  const currentLine = lines[cursorLine] ?? ''
  const beforeCursor = currentLine.slice(0, cursorCol)
  const match = beforeCursor.match(TOKEN_PATTERN)
  if (!match) return null

  const delimiter = match[1] ?? ''
  const query = match[2] ?? ''
  const tokenStartCol = match.index + delimiter.length
  const textBeforeSlash = textBeforePosition(lines, cursorLine, tokenStartCol)

  // The built-in provider already owns command-position `/...` completion.
  // This extension only handles slash tokens after real prompt text.
  if (!/\S/.test(textBeforeSlash)) return null

  return {
    query,
    prefix: beforeCursor.slice(tokenStartCol),
    tokenStartCol,
  }
}

function commandValue(command) {
  return `/${String(command.name ?? '').replace(/^\/+/, '')}`
}

function skillName(command) {
  return String(command.name ?? '').replace(/^skill:/, '')
}

function commandSearchText(command) {
  return [skillName(command), command.name, command.description, command.sourceInfo?.source]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function formatSkillItem(command) {
  const value = commandValue(command)
  const label = `/${skillName(command)}`
  const description = command.description ? `${command.description} → ${value}` : `pi skill → ${value}`
  return {
    value,
    label,
    description,
  }
}

function fuzzySubsequenceScore(haystack, needle) {
  if (!needle) return 1

  let lastIndex = -1
  let score = 0
  for (const char of needle) {
    const index = haystack.indexOf(char, lastIndex + 1)
    if (index === -1) return 0
    score += index === lastIndex + 1 ? 3 : 1
    lastIndex = index
  }
  return score
}

function scoreCommand(command, query) {
  const normalizedQuery = query.toLowerCase()
  const value = commandValue(command).toLowerCase()
  const name = String(command.name ?? '').toLowerCase()
  const bareName = skillName(command).toLowerCase()
  const searchText = commandSearchText(command)

  if (!normalizedQuery) return 1
  if (bareName === normalizedQuery) return 1100
  if (value === `/${normalizedQuery}` || name === normalizedQuery) return 1000
  if (bareName.startsWith(normalizedQuery)) return 950 - bareName.length
  if (value.startsWith(`/${normalizedQuery}`) || name.startsWith(normalizedQuery)) return 900 - name.length
  if (searchText.includes(normalizedQuery)) return 600 - searchText.indexOf(normalizedQuery)

  if (normalizedQuery.length < 3) return 0

  const fuzzyScore = fuzzySubsequenceScore(searchText, normalizedQuery)
  return fuzzyScore > 0 ? 100 + fuzzyScore : 0
}

export function getSkillSuggestions(commands, query, maxSuggestions = MAX_SUGGESTIONS) {
  return commands
    .filter((command) => command?.source === 'skill' && command.name)
    .map((command, index) => ({ command, index, score: scoreCommand(command, query) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || String(a.command.name).localeCompare(String(b.command.name)) || a.index - b.index)
    .slice(0, maxSuggestions)
    .map((candidate) => formatSkillItem(candidate.command))
}

function applyCompletionFallback(lines, cursorLine, cursorCol, item, prefix) {
  const nextLines = [...lines]
  const line = nextLines[cursorLine] ?? ''
  const startCol = Math.max(0, cursorCol - prefix.length)
  nextLines[cursorLine] = `${line.slice(0, startCol)}${item.value}${line.slice(cursorCol)}`
  return {
    lines: nextLines,
    cursorLine,
    cursorCol: startCol + item.value.length,
  }
}

function createInlineSkillAutocompleteProvider(pi, current) {
  return {
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const token = extractInlineSlashToken(lines, cursorLine, cursorCol)
      if (!token) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options)
      }

      const items = getSkillSuggestions(pi.getCommands(), token.query)
      if (options.signal.aborted || items.length === 0) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options)
      }

      return {
        prefix: token.prefix,
        items,
      }
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      if (current.applyCompletion) {
        return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix)
      }
      return applyCompletionFallback(lines, cursorLine, cursorCol, item, prefix)
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true
    },
  }
}

export default function inlineSkillAutocomplete(pi) {
  pi.on('session_start', (_event, ctx) => {
    if (!ctx.hasUI) return
    ctx.ui.addAutocompleteProvider((current) => createInlineSkillAutocompleteProvider(pi, current))
  })
}
