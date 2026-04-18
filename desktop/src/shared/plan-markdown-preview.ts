/** Strip YAML frontmatter for rendered markdown preview of agent plan files. */
export function stripYamlFrontmatterForPreview(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
}
