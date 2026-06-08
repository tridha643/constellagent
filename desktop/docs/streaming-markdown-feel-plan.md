# Streaming Markdown — "feels really good" plan

**Goal:** make streaming assistant markdown in the Conductor chat feel smooth, alive, and
stable — no jitter, no flicker, no layout pop — matching the bar set by Codex's TUI and the
ChatGPT/Claude desktop reveal. Token cadence should feel like steady typing, not bursty
network packets.

> Scope note: this is the **prosemark** (CodeMirror 6) Conductor path — the primary renderer.
> The pi-gui Streamdown fallback is explicitly out of scope per request, except for one
> remount-flicker fix.

---

## Research conclusion (the design driver)

Checked, ~now, via `nia` against indexed source + the local drivers:

- **openai/codex** `codex-rs/tui/` (the gold standard). Its streaming is a **producer/consumer
  split**: bursty `AgentMessageDelta`s are the producer; a **fixed ~50ms commit-tick timer** is
  the consumer. They never touch — they communicate through a `VecDeque` of rendered lines.
  Key mechanisms:
  - **Newline-gated commits** (`markdown_stream.rs::commit_complete_source`): only release source
    up to the last `\n`. A half-typed line (`## Add`) stays buffered until complete, so a line is
    never re-styled mid-flight. → kills markdown reflow flicker.
  - **Decoupled cadence** (`app.rs` `StartCommitAnimation` 50ms clock → `on_commit_tick`): drains
    **one line per tick** in steady state — render speed is set by the timer, *not* the network.
  - **Adaptive two-gear catch-up** (`streaming/chunking.rs`): timestamps each queued line; if
    backlog grows (≥8 lines queued or oldest ≥120ms) it flips to "flush all" with hysteresis
    (exit only after staying calm 250ms) so it never visibly lags and never gear-flaps.
  - **Block-level holdback** (`controller.rs` `TableHoldbackScanner`): tables/non-incremental
    blocks stay in a re-rendered "mutable tail" until closed, then commit as a unit.
  - **Finalize = one full re-render** of the whole source; transient streaming artifacts vanish.
  - **Reasoning ≠ answer**: reasoning deltas feed a transient shimmer/status header
    (`status_indicator_widget.rs`, self-scheduling 32ms); only the answer streams through the
    line pipeline.
- **Local drivers** (`cursor-driver.ts`, `codex-driver.ts`, `agent-driver.ts`,
  `agent-chat-host.ts`): both providers emit **cumulative full-text snapshots**; the host
  prefix-diffs via `computeTextDelta`/`normalizeAssistantStreamDelta` and broadcasts a small
  delta over `AGENT_CHAT_ASSISTANT_DELTA` **immediately, un-throttled, per token**. The
  renderer (`ChatMessage.tsx`) then calls `MarkdownStream.appendDelta` **directly on every
  delta**. → **render cadence == network cadence == bursty.** This is the core "doesn't feel
  good" cause.
- **codehike token-transitions** (docs) — confirms the WAAPI `element.animate` approach for
  smooth code-block transitions if we want animated code later (non-goal for v1).
- **emil-design-eng / web-animation-design**: fade is comprehension-aiding and *allowed* under
  reduced motion (opacity only); only animate `transform`/`opacity`; custom ease-out
  `cubic-bezier(0.23,1,0.32,1)`; never animate keyboard-frequent actions; under reduced motion
  prefer **instant** over animated reveal.

**The one fact that drives everything:** Codex inserts a render-cadence governor between the
network and the view; we currently have none. Adding a small **rAF smoothing pacer** is the
highest-leverage change — it converts bursty appends into steady reveal and, as a side effect,
collapses per-token Shiki/mermaid re-renders into ≤1 dispatch per frame.

---

## Current state (concrete problems)

1. **Bursty reveal.** `ChatMessage.tsx:141-154` appends the entire new slice the instant each
   IPC delta lands. Network jitter → visible chunky text bursts; nothing paces it.
2. **Per-token re-highlight.** Every `appendDelta` dispatch re-runs the CodeMirror language
   parse + Shiki/mermaid decorations (`MarkdownStream.tsx:164-165`). Fast streams spike CPU.
3. **Decoration "pop."** Tables/folds/mermaid resolve on a 120ms debounce
   (`PROSEMARK_DECORATION_SYNC_DELAY_MS`), so structure visibly snaps in behind the text.
4. **Variant remount flicker.** `pi-gui/message-markdown.tsx:97` keys the wrapper on `variant`;
   a mid-stream plain→prosemark/segmented switch **remounts** and drops the subtree.
5. **No liveness cue.** Native CM caret is hidden (`prosemark-chat-theme.css:210`); there is no
   streaming caret. Only the empty-state `MuloadLoader` signals activity.
6. **Motion not preference-aware in JS.** `usePrefersReducedMotion()` exists but neither
   `ChatMessage` nor the renderer consults it; reveal speed ignores the preference.

## Non-goals (v1)

- Animated per-token code transitions (codehike) — later.
- Reworking the Streamdown pi-gui fallback (only the remount-key fix).
- Changing the main-process delta protocol or driver diffing.
- Per-character DOM fade (too expensive in CM6 — see Decision 4).

---

## Locked decisions

| # | Topic | Decision |
|---|-------|----------|
| 1 | **Render-cadence governor** | Add a per-message **rAF smoothing pacer** between transcript text (target) and `MarkdownStream.appendDelta`. Transcript stays source of truth; the pacer owns `displayedLen` and advances it toward `target.length` each frame. |
| 2 | **Cadence law** | Self-regulating, no hysteresis needed: `step = max(MIN_CHARS, ceil(remaining / CATCHUP_FRAMES))`, **`CATCHUP_FRAMES = 6`** (snappy, minimal trail — user-locked), `MIN_CHARS ≈ 2`. Naturally accelerates with backlog, eases as it catches up. Cap `step` so a huge paste can't dump in one frame (`MAX_CHARS ≈ 400`). |
| 3 | **Finalize** | When `isStreaming` goes false: immediately append all remaining text (no waiting), then `refreshDecorations()`. The completed message is always the full clean render. |
| 4 | **Reveal motion** | Primary effect = **trailing-edge fade mask**: the last ~1.5 lines carry a subtle opacity gradient (text emerges faint→full) via a GPU-cheap CSS mask on the streaming container. No per-char DOM nodes. Per-char/word fade is a non-goal. |
| 5 | **Streaming caret** | Custom caret widget (`▍`) at doc end via a CodeMirror decoration, shown only while streaming. Gentle blink (`opacity` step, ~1.06s). Replaces the hidden native caret. |
| 6 | **Reduced motion** | When `prefers-reduced-motion: reduce`: **bypass the pacer** (instant append), no trailing fade, **static** (non-blinking) caret. Driven by `usePrefersReducedMotion()` in `ChatMessage`. |
| 7 | **Mermaid during stream** | Skip rendering an **unclosed** ` ```mermaid ` fence; only render once the closing fence arrives. Avoids flashing broken/҂error diagrams mid-stream. |
| 8 | **Variant stability** | Lock the pi-gui `message-markdown` variant for the lifetime of a streaming message (don't switch plain→prosemark mid-stream) so the `key={variant}` wrapper never remounts. |
| 9 | **Scope of pacer** | Pacer governs the **assistant answer** only. Reasoning/thinking stays in its existing transient channel (ActivityTicker / MuloadLoader) — ephemeral, not paced. |
| 10 | **Tokens & easing** | Reuse existing `--ease-out: cubic-bezier(0.23,1,0.32,1)`, `--duration-enter: 200ms`. Trailing fade ~200–300ms ease-out. Keep the existing 200ms `messageFadeIn` entrance. |

---

## Architecture

```
AGENT_CHAT_ASSISTANT_DELTA (per-token, bursty, un-throttled)
        │
        ▼
applyAssistantDeltaToTranscript → transcript state (full text)   [source of truth]
        │  (React re-render)
        ▼
ChatMessage.normalizedText  =  TARGET string
        │
        ▼
┌───────────────────────────────────────────────┐
│  useStreamingTextPacer (rAF governor)          │   ← NEW
│   displayedLen ──step()──► toward target.length│
│   step = clamp(ceil(remaining/8), 2, 400)      │
└───────────────────────────────────────────────┘
        │  appendDelta(targetSlice(displayedLen, next))  ≤1 dispatch / frame
        ▼
MarkdownStream / CodeMirror 6  ── incremental Lezer parse
        │
        ├─ prosemarkDecorationSync (120ms)  → tables / folds / mermaid(closed only)
        ├─ streaming caret widget (doc end, while streaming)        ← NEW
        └─ trailing-fade mask (CSS, last ~1.5 lines, while streaming) ← NEW
        │
        ▼ (isStreaming → false)
finalize(): flush remaining → refreshDecorations()  → clean full render
```

## File changes

| File | New/Mod | Responsibility |
|------|---------|----------------|
| `chat/use-streaming-text-pacer.ts` | **New** | rAF governor hook wrapping a `MarkdownStreamHandle` ref; owns `displayedLen`, schedules frames, exposes `setTarget`, `finalize`, `reset`. |
| `chat/streaming-pacer-math.ts` | **New** | Pure `computeRevealStep(displayedLen, targetLen, opts)` — the cadence law, fully unit-testable. |
| `lib/prosemark/streaming-decorations.ts` | **New** | CodeMirror extension: caret widget at doc end + trailing-region class, toggled by a `setStreaming` `StateEffect`. |
| `lib/prosemark/MarkdownStream.tsx` | Mod | Add `setStreaming(active)` to the imperative handle (drives caret/trailing decorations); wire the new extension. |
| `chat/ChatMessage.tsx` | Mod | Replace direct `appendDelta`-on-change with the pacer; call `setStreaming`; consult `usePrefersReducedMotion()` to bypass pacer/fade and freeze the caret. |
| `lib/prosemark/mermaid/mermaid-decorations.ts` | Mod | Skip unclosed mermaid fences (Decision 7). |
| `pi-gui/message-markdown.tsx` | Mod | Stabilize streaming `variant` (Decision 8). |
| `lib/prosemark/prosemark-chat-theme.css` | Mod | Caret styles + blink keyframes, trailing-fade mask, `prefers-reduced-motion` guards. |

---

## Exhaustive case coverage

| Case | Behavior |
|------|----------|
| Steady token stream (keeps up) | Pacer reveals `MIN_CHARS..` per frame; display trails target by < a few frames. Feels like smooth typing. |
| Bursty stream (network stall then dump) | Backlog grows; `ceil(remaining/8)` accelerates reveal; catches up within ~8 frames, no visible lag. |
| Giant single delta (paste / cached block) | `MAX_CHARS` cap prevents one-frame dump; revealed over a few frames, still fast. |
| Stream finishes while buffer non-empty | `finalize()` flushes remaining instantly → `refreshDecorations()`. No lingering half-revealed tail. |
| Open ` ``` ` code fence mid-stream | Revealed as plain text; Shiki applies once fence content parses; no broken-fence flash. |
| Open ` ```mermaid ` fence mid-stream | **No** mermaid render until closing fence (Decision 7). |
| Table being streamed row-by-row | Text reveals; `tableDecorations` resolve on the 120ms sync once rows parse; trailing fade hides the seam. |
| `prefers-reduced-motion: reduce` | Pacer bypassed (instant), no fade, static caret. |
| Message completes, user scrolls back | Completed message = static full render, no caret, no fade, no pacer running. |
| New turn starts (new streaming message) | Pacer `reset()` for the new message id; previous message frozen as final. |
| Provider sends identical final `AgentMessage` after deltas | Host already prefix-diffs to empty delta; pacer sees no new target → no-op (no re-render). |
| Component unmounts mid-stream | rAF cancelled in cleanup; no leaked frame loop. |
| Variant would switch plain→prosemark mid-stream | Variant locked for the streaming message → no remount (Decision 8). |
| Empty assistant message (still thinking) | `MuloadLoader` shows as today; pacer idle until first text. |

## Test matrix

| Test | File | Asserts |
|------|------|---------|
| `computeRevealStep` keeps up | `streaming-pacer-math.test.ts` | small remaining → `MIN_CHARS`, monotonic, never overshoots target. |
| accelerates under backlog | same | large remaining → `ceil(remaining/8)`, ≤ `MAX_CHARS`. |
| converges & terminates | same | repeated application reaches `targetLen` exactly, then returns 0. |
| finalize flushes | `use-streaming-text-pacer.test.ts` (jsdom) | on `finalize`, handle receives the full remaining slice + `refreshDecorations`. |
| reduced-motion bypass | `ChatMessage` test | with reduced motion, append is immediate (no rAF deferral), caret static. |
| variant stability | `message-markdown` test | streaming message keeps one `variant` across plain→chip transitions. |
| mermaid holdback | `mermaid-decorations.test.ts` | unclosed mermaid fence yields no widget; closed fence yields one. |
| caret lifecycle | prosemark decoration test | caret present iff `setStreaming(true)`; gone after finalize. |

## Verification

```bash
cd desktop
bun test src/renderer/components/Conductor/chat/streaming-pacer-math.test.ts
bun test src/renderer/components/Conductor/chat/use-streaming-text-pacer.test.ts
bun test src/renderer/lib/prosemark/mermaid/mermaid-decorations.test.ts
bun run build 2>&1 | tail -20
# Manual: stream a long answer w/ a table, a code block, and a mermaid diagram;
#   watch for jitter, decoration pop, caret, and end-of-stream flush. Toggle OS
#   reduce-motion and re-stream. Throttle network (or add artificial delta jitter) to test catch-up.
```

## Risks / notes

- **React render storm is upstream of the pacer.** The delta listener calls `setTranscript`
  per token, re-rendering `ChatMessage` per token regardless of the pacer. The pacer fixes the
  *visual* cadence and collapses CM dispatches, but not the React render count. If profiling
  shows this is hot, a follow-up is to coalesce `applyAssistantDeltaToTranscript` onto a 40ms/
  rAF flush (mirroring `TRANSCRIPT_FLUSH_MS`). Out of scope for v1; flagged.
- **Trailing-fade mask vs. CodeMirror scroller.** A `mask-image` on the content host must not
  clip the caret or interfere with selection/scroll. Prototype on `.cm-content` trailing only;
  fall back to a simple last-line opacity decoration if the mask fights CM layout.
- **Convergence point with Codex:** we deliberately adopt Codex's *decouple-cadence* idea but
  **not** its line-queue/newline-gating — CM6 already parses incrementally and tolerates partial
  lines, so char-level pacing is simpler and smoother on the web than line-at-a-time. This is a
  conscious divergence, surfaced here.
- **Caret at doc end during fast catch-up** may appear to "race ahead" of the fade. Keep caret
  pinned to `displayedLen` (the revealed end), not `target.length`.
```
