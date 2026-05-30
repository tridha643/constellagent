import { atMentionFileName } from '../../../../shared/composer-at-mention'
import {
  segmentComposerDraft,
  type ComposerDraftSegment,
} from '../../../../shared/composer-draft-segments'
import type { AppearanceThemeId } from '../../../theme/appearance'
import { createSharedFileIconElement } from '../../../utils/file-presentation'
import { createPrOpenIconElement } from './composer-pr-icon'
import styles from '../Conductor.module.css'

/** Invisible caret anchor after a chip; stripped on serialize. */
export const COMPOSER_EDITABLE_TAIL_CHAR = '\u200B'

function isEditableTailTextNode(node: ChildNode): boolean {
  return node.nodeType === Node.TEXT_NODE && node.textContent === COMPOSER_EDITABLE_TAIL_CHAR
}

function removeEditableTail(root: HTMLElement): void {
  const last = root.lastChild
  if (last && isEditableTailTextNode(last)) {
    last.remove()
  }
}

function serializedLength(node: ChildNode): number {
  if (isEditableTailTextNode(node)) {
    return 0
  }
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.length ?? 0
  }
  if (node instanceof HTMLElement) {
    const token = node.dataset.composerToken
    if (token === 'file') {
      const path = node.dataset.composerPath ?? ''
      return 1 + path.length
    }
    if (token === 'skill') {
      return node.dataset.composerCommand?.length ?? 0
    }
    if (token === 'pr') {
      const number = node.dataset.composerPrNumber ?? ''
      return number ? 1 + number.length : 0
    }
  }
  return node.textContent?.length ?? 0
}

/** Walk the contenteditable tree and rebuild the canonical draft string. */
export function serializeComposerEditor(root: HTMLElement): string {
  let out = ''
  for (const node of root.childNodes) {
    if (isEditableTailTextNode(node)) {
      continue
    }
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? ''
      continue
    }
    if (!(node instanceof HTMLElement)) continue
    if (node.dataset.composerToken === 'file') {
      const path = node.dataset.composerPath ?? ''
      if (path) out += `@${path}`
      continue
    }
    if (node.dataset.composerToken === 'skill') {
      out += node.dataset.composerCommand ?? ''
      continue
    }
    if (node.dataset.composerToken === 'pr') {
      const number = node.dataset.composerPrNumber ?? ''
      if (number) out += `#${number}`
    }
  }
  return out
}

function composerChipIconPath(segment: Extract<ComposerDraftSegment, { kind: 'file' | 'skill' }>): string {
  if (segment.kind === 'file') return segment.relativePath
  const name = segment.name
  return name.includes('.') ? name : `${name}.md`
}

function appendComposerChipIcon(
  iconWrap: HTMLElement,
  path: string,
  appearanceThemeId: AppearanceThemeId,
): void {
  iconWrap.replaceChildren(
    createSharedFileIconElement(path, styles.composerFileChipIcon, appearanceThemeId),
  )
}

/** Refresh pierre/trees sprites when theme changes without rebuilding chip DOM. */
export function hydrateComposerDraftChipIcons(
  root: HTMLElement,
  appearanceThemeId: AppearanceThemeId,
): void {
  for (const chip of root.querySelectorAll<HTMLElement>('[data-composer-token]')) {
    const token = chip.dataset.composerToken
    const iconWrap = chip.querySelector<HTMLElement>('[data-composer-chip-icon-wrap]')
    if (!iconWrap) continue
    if (token === 'file') {
      const path = chip.dataset.composerPath
      if (path) appendComposerChipIcon(iconWrap, path, appearanceThemeId)
      continue
    }
    if (token === 'skill') {
      const command = chip.dataset.composerCommand ?? ''
      const name = command.startsWith('/') ? command.slice(1) : command
      if (name) appendComposerChipIcon(iconWrap, composerChipIconPath({ kind: 'skill', command, name, start: 0, end: 0 }), appearanceThemeId)
    }
  }
}

function createChipRemoveControl(onRemove: () => void): HTMLSpanElement {
  const remove = document.createElement('span')
  remove.className = styles.composerFileChipRemove
  remove.setAttribute('role', 'button')
  remove.setAttribute('tabindex', '-1')
  remove.setAttribute('aria-label', 'Remove')
  remove.textContent = '×'
  remove.addEventListener('mousedown', (event) => {
    event.preventDefault()
  })
  remove.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onRemove()
  })
  return remove
}

function createFileChipElement(
  segment: Extract<ComposerDraftSegment, { kind: 'file' }>,
  appearanceThemeId: AppearanceThemeId,
  onRemoveToken: (start: number, end: number) => void,
): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.className = styles.composerFileChip
  chip.contentEditable = 'false'
  chip.dataset.composerToken = 'file'
  chip.dataset.composerPath = segment.relativePath
  chip.dataset.start = String(segment.start)
  chip.dataset.end = String(segment.end)
  chip.dataset.testid = 'composer-file-chip'

  const main = document.createElement('span')
  main.className = styles.composerFileChipMain
  main.title = segment.relativePath

  const iconWrap = document.createElement('span')
  iconWrap.className = styles.composerFileChipIconWrap
  iconWrap.dataset.composerChipIconWrap = 'true'
  appendComposerChipIcon(iconWrap, segment.relativePath, appearanceThemeId)

  const divider = document.createElement('span')
  divider.className = styles.composerFileChipDivider
  divider.setAttribute('aria-hidden', 'true')

  const label = document.createElement('span')
  label.className = styles.composerFileChipLabel
  label.textContent = atMentionFileName(segment.relativePath)

  main.append(iconWrap, divider, label)
  chip.append(main, createChipRemoveControl(() => onRemoveToken(segment.start, segment.end)))
  return chip
}

function createSkillChipElement(
  segment: Extract<ComposerDraftSegment, { kind: 'skill' }>,
  appearanceThemeId: AppearanceThemeId,
  onRemoveToken: (start: number, end: number) => void,
): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.className = styles.composerFileChip
  chip.contentEditable = 'false'
  chip.dataset.composerToken = 'skill'
  chip.dataset.composerCommand = segment.command
  chip.dataset.start = String(segment.start)
  chip.dataset.end = String(segment.end)
  chip.dataset.testid = 'composer-skill-chip'

  const main = document.createElement('span')
  main.className = styles.composerFileChipMain
  main.title = segment.command

  const iconWrap = document.createElement('span')
  iconWrap.className = styles.composerFileChipIconWrap
  iconWrap.dataset.composerChipIconWrap = 'true'
  appendComposerChipIcon(iconWrap, composerChipIconPath(segment), appearanceThemeId)

  const divider = document.createElement('span')
  divider.className = styles.composerFileChipDivider
  divider.setAttribute('aria-hidden', 'true')

  const label = document.createElement('span')
  label.className = styles.composerFileChipLabel
  label.textContent = segment.name

  main.append(iconWrap, divider, label)
  chip.append(main, createChipRemoveControl(() => onRemoveToken(segment.start, segment.end)))
  return chip
}

function createPrChipElement(
  segment: Extract<ComposerDraftSegment, { kind: 'pr' }>,
  onRemoveToken: (start: number, end: number) => void,
): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.className = styles.composerFileChip
  chip.contentEditable = 'false'
  chip.dataset.composerToken = 'pr'
  chip.dataset.composerPrNumber = String(segment.number)
  chip.dataset.start = String(segment.start)
  chip.dataset.end = String(segment.end)
  chip.dataset.testid = 'composer-pr-chip'

  const main = document.createElement('span')
  main.className = styles.composerFileChipMain
  main.title = `Pull request #${segment.number}`

  const iconWrap = document.createElement('span')
  iconWrap.className = styles.composerFileChipIconWrap
  iconWrap.dataset.composerChipIconWrap = 'true'
  iconWrap.append(createPrOpenIconElement())

  const divider = document.createElement('span')
  divider.className = styles.composerFileChipDivider
  divider.setAttribute('aria-hidden', 'true')

  const label = document.createElement('span')
  label.className = styles.composerFileChipLabel
  label.textContent = `#${segment.number}`

  main.append(iconWrap, divider, label)
  chip.append(main, createChipRemoveControl(() => onRemoveToken(segment.start, segment.end)))
  return chip
}

/** Ensure a caret anchor exists when the draft ends on an inline chip. */
export function ensureComposerEditableTail(root: HTMLElement): Text | null {
  removeEditableTail(root)
  const last = root.lastChild
  if (!(last instanceof HTMLElement) || !last.dataset.composerToken) {
    return null
  }
  const tail = document.createTextNode(COMPOSER_EDITABLE_TAIL_CHAR)
  root.append(tail)
  return tail
}

function draftEndsOnInlineChip(text: string): boolean {
  const segments = segmentComposerDraft(text)
  const last = segments[segments.length - 1]
  return last?.kind === 'file' || last?.kind === 'skill' || last?.kind === 'pr'
}

export function composerDraftDomMatchesText(root: HTMLElement, text: string): boolean {
  if (serializeComposerEditor(root) !== text) return false

  let chipCount = 0
  for (const node of root.childNodes) {
    if (isEditableTailTextNode(node)) continue
    if (node instanceof HTMLElement && node.dataset.composerToken) chipCount++
  }
  const tokenSegments = segmentComposerDraft(text).filter((segment) => segment.kind !== 'text').length
  if (chipCount !== tokenSegments) return false

  const lastChild = root.lastChild
  const hasTail = Boolean(lastChild && isEditableTailTextNode(lastChild))
  if (draftEndsOnInlineChip(text)) {
    return hasTail
  }
  return !hasTail
}

export function renderComposerEditor(
  root: HTMLElement,
  text: string,
  appearanceThemeId: AppearanceThemeId,
  onRemoveToken: (start: number, end: number) => void,
): void {
  root.replaceChildren()
  if (!text) return

  for (const segment of segmentComposerDraft(text)) {
    if (segment.kind === 'text') {
      if (segment.text) root.append(document.createTextNode(segment.text))
      continue
    }
    if (segment.kind === 'file') {
      root.append(createFileChipElement(segment, appearanceThemeId, onRemoveToken))
      continue
    }
    if (segment.kind === 'skill') {
      root.append(createSkillChipElement(segment, appearanceThemeId, onRemoveToken))
      continue
    }
    if (segment.kind === 'pr') {
      root.append(createPrChipElement(segment, onRemoveToken))
    }
  }

  ensureComposerEditableTail(root)
}

export function getComposerEditorCaretOffset(root: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0

  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return 0

  let offset = 0
  for (const node of root.childNodes) {
    if (isEditableTailTextNode(node)) {
      if (node.contains(range.startContainer) || node === range.startContainer) {
        return offset
      }
      continue
    }

    if (!node.contains(range.startContainer) && node !== range.startContainer) {
      offset += serializedLength(node)
      continue
    }

    if (node.nodeType === Node.TEXT_NODE) {
      if (node === range.startContainer) {
        return offset + range.startOffset
      }
      return offset + (node.textContent?.length ?? 0)
    }

    if (node instanceof HTMLElement && node.dataset.composerToken) {
      const end = Number(node.dataset.end ?? offset)
      return end
    }
    break
  }

  return offset
}

export function setComposerEditorCaretOffset(root: HTMLElement, start: number, end: number): void {
  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  let offset = 0
  let placed = false

  for (const node of root.childNodes) {
    if (isEditableTailTextNode(node)) {
      if (!placed) {
        const tailLen = node.textContent?.length ?? 0
        range.setStart(node, Math.min(start - offset, tailLen))
        range.setEnd(node, Math.min(end - offset, tailLen))
        placed = true
      }
      break
    }

    const len = serializedLength(node)
    const nodeStart = offset
    const nodeEnd = offset + len

    if (start <= nodeEnd) {
      if (node.nodeType === Node.TEXT_NODE) {
        const textLen = node.textContent?.length ?? 0
        const localStart = Math.max(0, Math.min(start - nodeStart, textLen))
        const localEnd = Math.max(localStart, Math.min(end - nodeStart, textLen))
        range.setStart(node, localStart)
        range.setEnd(node, localEnd)
      } else if (start <= nodeStart) {
        range.setStartBefore(node)
        range.setEndBefore(node)
      } else {
        range.setStartAfter(node)
        range.setEndAfter(node)
      }
      placed = true
      break
    }
    offset = nodeEnd
  }

  if (!placed) {
    const tail = root.lastChild
    if (tail && isEditableTailTextNode(tail)) {
      const tailLen = tail.textContent?.length ?? 0
      range.setStart(tail, tailLen)
      range.setEnd(tail, tailLen)
    } else {
      range.selectNodeContents(root)
      range.collapse(false)
    }
  }

  selection.removeAllRanges()
  selection.addRange(range)
}

export function autoGrowComposerEditor(el: HTMLElement, maxHeight = 200): void {
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
}
