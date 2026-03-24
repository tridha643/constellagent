/** True for paths that should open in the markdown preview tab by default (agent plans, docs). */
export function isMarkdownDocumentPath(filePath: string): boolean {
  const lower = filePath.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.mdx')
}
