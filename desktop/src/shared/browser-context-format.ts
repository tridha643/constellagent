import type {
  ComponentMutationContext,
  SelectedComponentContext,
} from './browser-context-types'

function compact(value: string | undefined, max = 280): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function formatAttrs(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .filter(([key]) => !key.startsWith('data-agent-'))
    .slice(0, 12)
    .map(([key, value]) => `${key}="${compact(value, 120)}"`)
    .join(' ')
}

export function formatSelectedComponentContext(component: SelectedComponentContext): string {
  const lines = [
    'Browser selected component',
    `URL: ${component.url}`,
    `Element: <${component.tag.toLowerCase()}${component.id ? ` id="${component.id}"` : ''}${component.className ? ` class="${component.className}"` : ''}>`,
    component.role ? `Role: ${component.role}` : '',
    component.ariaLabel ? `Aria label: ${component.ariaLabel}` : '',
    `DOM path: ${component.domPath}`,
    `Bounds: x=${Math.round(component.boundingBox.x)} y=${Math.round(component.boundingBox.y)} w=${Math.round(component.boundingBox.width)} h=${Math.round(component.boundingBox.height)}`,
    component.agentMetadata.file
      ? `Source metadata: ${component.agentMetadata.file}${component.agentMetadata.line ? `:${component.agentMetadata.line}` : ''}`
      : '',
    `Text: ${compact(component.text)}`,
    component.nearbyText.length ? `Nearby text: ${component.nearbyText.map((t) => compact(t, 100)).join(' | ')}` : '',
    Object.keys(component.attributes).length ? `Attributes: ${formatAttrs(component.attributes)}` : '',
  ].filter(Boolean)

  if (component.sourceSnippet) {
    lines.push(
      '',
      `Source snippet @${component.sourceSnippet.filePath}:${component.sourceSnippet.startLine}-${component.sourceSnippet.endLine}`,
      '```',
      component.sourceSnippet.text,
      '```',
    )
  }

  return lines.join('\n')
}

export function formatComponentMutationContext(mutation: ComponentMutationContext): string {
  const css = Object.entries(mutation.changedCssProperties)
    .map(([key, value]) => `${key}: ${value}`)
    .join('; ')
  return [
    `Browser component ${mutation.mutationType} mutation`,
    `URL: ${mutation.after.url}`,
    `Element: <${mutation.after.tag.toLowerCase()}> ${mutation.after.domPath}`,
    `Before bounds: x=${Math.round(mutation.boundingBoxBefore.x)} y=${Math.round(mutation.boundingBoxBefore.y)} w=${Math.round(mutation.boundingBoxBefore.width)} h=${Math.round(mutation.boundingBoxBefore.height)}`,
    `After bounds: x=${Math.round(mutation.boundingBoxAfter.x)} y=${Math.round(mutation.boundingBoxAfter.y)} w=${Math.round(mutation.boundingBoxAfter.width)} h=${Math.round(mutation.boundingBoxAfter.height)}`,
    css ? `Changed CSS: ${css}` : '',
    mutation.generatedDelta ? `Delta: ${mutation.generatedDelta}` : '',
    mutation.after.agentMetadata.file
      ? `Source metadata: ${mutation.after.agentMetadata.file}${mutation.after.agentMetadata.line ? `:${mutation.after.agentMetadata.line}` : ''}`
      : '',
    `Text: ${compact(mutation.after.text, 220)}`,
  ].filter(Boolean).join('\n')
}
