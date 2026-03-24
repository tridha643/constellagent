// Shared file-extension → language maps for Monaco and markdown fences.

/** Map file extensions to Monaco language IDs. */
const EXT_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  jsx: 'javascriptreact',
  json: 'json',
  md: 'markdown',
  mdx: 'markdown',
  css: 'css',
  scss: 'scss',
  html: 'html',
  py: 'python',
  rs: 'rust',
  go: 'go',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  toml: 'ini',
  xml: 'xml',
  sql: 'sql',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  rb: 'ruby',
  php: 'php',
  lua: 'lua',
}

/** Short tags for markdown fenced code blocks. */
const FENCE_MAP: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  json: 'json',
  md: 'md',
  mdx: 'mdx',
  css: 'css',
  scss: 'scss',
  html: 'html',
  py: 'python',
  rs: 'rust',
  go: 'go',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  toml: 'toml',
  xml: 'xml',
  sql: 'sql',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  rb: 'ruby',
  php: 'php',
  lua: 'lua',
}

function extOf(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? ''
}

/** Get the Monaco language ID for a file path. */
export function getLanguage(path: string): string {
  return EXT_MAP[extOf(path)] || 'plaintext'
}

/** Get the short fence tag for a markdown code block. */
export function getFenceTag(path: string): string {
  return FENCE_MAP[extOf(path)] || ''
}
