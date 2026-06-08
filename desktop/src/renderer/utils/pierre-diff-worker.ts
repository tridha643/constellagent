import PierreDiffWorker from '@pierre/diffs/worker/worker.js?worker'

/** Vite worker entry for @pierre/diffs syntax highlighting pool. */
export function createPierreDiffWorker(): Worker {
  return new PierreDiffWorker()
}
