import { removeAnnotation, type Client } from '../index.js'

export async function runRemove(db: Client, args: string[]) {
  const id = args[0]
  if (!id) throw new Error('Usage: constell-annotate remove <id>')

  await removeAnnotation(db, id)
  console.log(`Removed annotation ${id}`)
}
