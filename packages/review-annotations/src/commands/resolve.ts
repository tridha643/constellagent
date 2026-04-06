import { setResolved, type Client } from '../index.js'

export async function runResolve(db: Client, args: string[], resolved: boolean) {
  const id = args[0]
  if (!id) throw new Error(`Usage: constell-annotate ${resolved ? 'resolve' : 'unresolve'} <id>`)

  await setResolved(db, id, resolved)
  console.log(`Annotation ${id} ${resolved ? 'resolved' : 'unresolved'}`)
}
