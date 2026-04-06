import { removeAnnotation } from '../index.js';
export async function runRemove(db, args) {
    const id = args[0];
    if (!id)
        throw new Error('Usage: constell-annotate remove <id>');
    await removeAnnotation(db, id);
    console.log(`Removed annotation ${id}`);
}
