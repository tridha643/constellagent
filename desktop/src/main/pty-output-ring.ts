/**
 * Bounded, append-optimised ring of PTY output kept in the main process so the
 * renderer can rehydrate xterm scrollback after a remount.
 *
 * Previously stored as a single string: every `onData` event did
 * `ring + chunk` (full O(N) copy) plus a follow-up `slice` once full — two
 * ~2 MB allocations per chunk under heavy output (compiles, test runs). This
 * stores chunks instead, trims by shifting whole chunks off the front, and
 * only joins on snapshot (which is rare — only on tab remount).
 */
export class PtyOutputRing {
  private chunks: string[] = []
  private bytes = 0

  constructor(private readonly maxBytes: number) {}

  append(data: string): void {
    if (!data) return
    this.chunks.push(data)
    this.bytes += data.length
    if (this.bytes <= this.maxBytes) return

    // Drop whole chunks from the front until under the budget. Cheap when
    // chunks are modestly sized; degenerate runaway-tiny-chunks workloads are
    // bounded by the final partial-slice step below.
    while (this.chunks.length > 1 && this.bytes - this.chunks[0]!.length >= this.maxBytes) {
      this.bytes -= this.chunks.shift()!.length
    }

    // The remaining buffer may still exceed the budget by part of one chunk —
    // partially slice the head chunk so the strict bound holds.
    if (this.bytes > this.maxBytes && this.chunks.length > 0) {
      const overflow = this.bytes - this.maxBytes
      const head = this.chunks[0]!
      const trimmed = head.slice(overflow)
      this.chunks[0] = trimmed
      this.bytes -= overflow
    }
  }

  /** Concatenated snapshot for renderer rehydration; consolidates so repeat reads are O(1). */
  snapshot(): string {
    if (this.chunks.length === 0) return ''
    if (this.chunks.length === 1) return this.chunks[0]!
    const joined = this.chunks.join('')
    this.chunks = [joined]
    return joined
  }

  get size(): number {
    return this.bytes
  }
}
