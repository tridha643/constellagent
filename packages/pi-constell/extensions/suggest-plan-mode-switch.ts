import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent'
import { Key, Text, matchesKey, truncateToWidth } from '@mariozechner/pi-tui'
import { Type } from '@sinclair/typebox'

export type PlanModeSwitchOutcome = 'accepted' | 'declined' | 'timed_out' | 'already_active' | 'suppressed' | 'unavailable'

export interface SuggestPlanModeSwitchDetails {
  outcome: PlanModeSwitchOutcome
  activePlanPath?: string | null
  secondsRemaining?: number
  suppressedForPrompt?: boolean
}

export interface SuggestPlanModeSwitchHooks {
  isPlanModeEnabled: () => boolean
  isSuppressedForPrompt: () => boolean
  onAccepted: (ctx: ExtensionContext) => Promise<string | null> | string | null
  onDeclinedOrTimedOut: (outcome: 'declined' | 'timed_out') => void | Promise<void>
  onUnavailable?: () => void | Promise<void>
}

const SuggestPlanModeSwitchParams = Type.Object({
  reason: Type.Optional(Type.String({ description: 'Optional short reason this request would benefit from plan mode.' })),
})

function remainingSeconds(startedAt: number, durationMs: number): number {
  return Math.max(0, Math.ceil((durationMs - (Date.now() - startedAt)) / 1000))
}

function renderChoice(active: boolean, label: string, theme: any): string {
  return active
    ? theme.bg('selectedBg', theme.fg('text', ` ${label} `))
    : theme.fg('muted', ` ${label} `)
}

export default function registerSuggestPlanModeSwitch(pi: ExtensionAPI, hooks: SuggestPlanModeSwitchHooks): void {
  pi.registerTool({
    name: 'suggestPlanModeSwitch',
    label: 'Suggest Plan Mode Switch',
    description: 'Ask the user for explicit consent before switching a planning-heavy request from normal agent mode into plan mode.',
    promptSnippet: 'For planning-heavy asks in normal mode, use suggestPlanModeSwitch to request consent before entering plan mode. Never auto-switch.',
    promptGuidelines: [
      'Use suggestPlanModeSwitch for broad refactors, architecture work, migrations, ambiguous multi-file changes, or other planning-heavy requests.',
      'Do not use it for small direct edits, single-file fixes, or straightforward implementation tasks that can be executed immediately.',
      'The tool only requests consent. It must never be used as a way to auto-switch the user into plan mode.',
      'If the user declines or the prompt times out, continue in normal mode and do not ask again during the same prompt.',
      'If the tool reports that plan mode is already active or unavailable, continue with the current mode instead of retrying.',
    ],
    parameters: SuggestPlanModeSwitchParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (hooks.isPlanModeEnabled()) {
        return {
          content: [{ type: 'text', text: 'Plan mode is already active. Continue under plan mode rules.' }],
          details: { outcome: 'already_active' } satisfies SuggestPlanModeSwitchDetails,
        }
      }

      if (hooks.isSuppressedForPrompt()) {
        return {
          content: [{ type: 'text', text: 'The user already chose to stay in normal mode for this prompt. Continue in agent mode and do not ask again.' }],
          details: { outcome: 'suppressed', suppressedForPrompt: true } satisfies SuggestPlanModeSwitchDetails,
        }
      }

      if (!ctx.hasUI) {
        await hooks.onUnavailable?.()
        return {
          content: [{ type: 'text', text: 'Interactive consent is unavailable in this session, so plan mode was not activated. Continue in normal agent mode and do not retry for this prompt.' }],
          details: { outcome: 'unavailable', suppressedForPrompt: true } satisfies SuggestPlanModeSwitchDetails,
        }
      }

      const reason = typeof params.reason === 'string' ? params.reason.trim() : ''
      const details = await ctx.ui.custom<SuggestPlanModeSwitchDetails>((tui, theme, _keybindings, done) => {
        const durationMs = 15_000
        const startedAt = Date.now()
        let selectedIndex = 0
        let cachedLines: string[] | undefined
        let finished = false

        const finish = (outcome: 'accepted' | 'declined' | 'timed_out'): void => {
          if (finished) return
          finished = true
          clearInterval(interval)
          done({
            outcome,
            secondsRemaining: remainingSeconds(startedAt, durationMs),
            suppressedForPrompt: outcome !== 'accepted',
          })
        }

        const interval = setInterval(() => {
          if (finished) return
          if (Date.now() - startedAt >= durationMs) {
            finish('timed_out')
            return
          }
          cachedLines = undefined
          tui.requestRender()
        }, 250)

        function refresh(): void {
          cachedLines = undefined
          tui.requestRender()
        }

        function render(width: number): string[] {
          if (cachedLines) return cachedLines
          const lines: string[] = []
          const add = (line: string) => lines.push(truncateToWidth(line, width))
          const seconds = remainingSeconds(startedAt, durationMs)

          add(theme.fg('accent', '─'.repeat(Math.max(width, 1))))
          add(theme.fg('accent', theme.bold(' Switch to plan mode?')))
          lines.push('')
          add(theme.fg('text', ' This request looks planning-heavy. Plan mode will stay read-only until askUserQuestion completes.'))
          add(theme.fg('muted', ` Auto-stay in normal agent mode in ${seconds}s unless you accept.`))
          if (reason) {
            lines.push('')
            add(theme.fg('muted', ' Reason from the agent:'))
            add(theme.fg('text', ` ${reason}`))
          }
          lines.push('')
          add(` ${renderChoice(selectedIndex === 0, 'Accept plan mode', theme)}  ${renderChoice(selectedIndex === 1, 'Stay in agent mode', theme)}`)
          lines.push('')
          add(theme.fg('dim', ' ←→ or Tab switches • Enter confirms • Esc stays in agent mode'))
          add(theme.fg('accent', '─'.repeat(Math.max(width, 1))))
          cachedLines = lines
          return lines
        }

        function handleInput(data: string): void {
          if (matchesKey(data, Key.escape)) {
            finish('declined')
            return
          }
          if (matchesKey(data, Key.left) || matchesKey(data, Key.right) || matchesKey(data, Key.tab) || matchesKey(data, Key.shift('tab'))) {
            selectedIndex = selectedIndex === 0 ? 1 : 0
            refresh()
            return
          }
          if (matchesKey(data, Key.enter)) {
            finish(selectedIndex === 0 ? 'accepted' : 'declined')
          }
        }

        return {
          render,
          invalidate: () => {
            cachedLines = undefined
          },
          handleInput,
        }
      })

      if (details.outcome === 'accepted') {
        const activePlanPath = await hooks.onAccepted(ctx)
        return {
          content: [{
            type: 'text',
            text: [
              'The user accepted plan mode. Switch into plan mode immediately for this same prompt.',
              activePlanPath ? `Active plan file: ${activePlanPath}` : 'Active plan file: not allocated yet.',
              'Plan mode rules now apply: investigate with read-only tools first, askUserQuestion before any write/edit, and only write to the active plan file after that clarification round completes.',
            ].join('\n'),
          }],
          details: { ...details, activePlanPath } satisfies SuggestPlanModeSwitchDetails,
        }
      }

      if (details.outcome === 'declined' || details.outcome === 'timed_out') {
        await hooks.onDeclinedOrTimedOut(details.outcome)
        const verb = details.outcome === 'timed_out' ? 'timed out' : 'declined'
        return {
          content: [{ type: 'text', text: `The user ${verb} plan mode for this prompt. Stay in normal agent mode, continue the current request, and do not ask again during this prompt.` }],
          details,
        }
      }

      return {
        content: [{ type: 'text', text: 'Plan mode was not activated. Continue in normal agent mode.' }],
        details,
      }
    },

    renderCall(args, theme) {
      const reason = typeof args.reason === 'string' && args.reason.trim() ? ` · ${args.reason.trim()}` : ''
      return new Text(
        theme.fg('toolTitle', theme.bold('suggestPlanModeSwitch ')) + theme.fg('muted', `request consent${reason}`),
        0,
        0,
      )
    },

    renderResult(result, _options, theme) {
      const details = result.details as SuggestPlanModeSwitchDetails | undefined
      const outcome = details?.outcome ?? 'unavailable'
      const label = outcome === 'accepted'
        ? theme.fg('success', '✓ accepted')
        : outcome === 'declined'
          ? theme.fg('warning', 'stayed in agent mode')
          : outcome === 'timed_out'
            ? theme.fg('warning', 'timed out → stayed in agent mode')
            : outcome === 'already_active'
              ? theme.fg('accent', 'already in plan mode')
              : outcome === 'suppressed'
                ? theme.fg('muted', 'already suppressed for this prompt')
                : theme.fg('muted', 'unavailable')
      return new Text(label, 0, 0)
    },
  })
}
