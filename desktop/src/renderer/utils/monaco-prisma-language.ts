/** Minimal Prisma schema highlighting — Monaco has no built-in `prisma` language. */
let registered = false

export function ensureMonacoPrismaLanguage(monaco: typeof import('monaco-editor')): void {
  if (registered) return
  registered = true
  monaco.languages.register({ id: 'prisma' })
  monaco.languages.setMonarchTokensProvider('prisma', {
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/'([^'\\]|\\.)*'/, 'string'],
        [/\b(?:model|enum|generator|datasource|type|view)\b/, 'keyword'],
        [/\b(?:String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes|Unsupported)\b/, 'type'],
        [/[{}()\[\]:?,]/, 'delimiter.bracket'],
        [/@@?[a-zA-Z_]\w*/, 'annotation'],
      ],
    },
  })
}
