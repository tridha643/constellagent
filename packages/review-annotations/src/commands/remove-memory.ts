import { removeMemory, type Client } from '../index.js'

export async function runRemoveMemory(db: Client, args: string[]) {
  const id = args[0]
  if (!id) throw new Error('Usage: constell-annotate remove-memory <id>')

  await removeMemory(db, id)
  console.log(`Removed memory ${id}`)
}
