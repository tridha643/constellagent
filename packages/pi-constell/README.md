# pi-constell-plan

`pi-constell-plan` adds a Claude Code-style plan mode to pi, including an agent-requested consent flow that can switch a planning-heavy prompt into plan mode without ever auto-switching.

## Features

- `/plan` toggles planning mode manually
- `/plan-off` and `/agent` leave planning mode explicitly
- `suggestPlanModeSwitch` lets the model request plan mode from normal agent mode, but only after explicit user approval
- the consent UI is inline/native, shows clear **Accept plan mode** vs **Stay in agent mode** actions, and times out after 15 seconds
- decline/timeout suppresses re-asking only for the current prompt; later prompts can suggest plan mode again
- non-interactive sessions fall back to a safe no-op and stay in normal agent mode
- codebase remains read-only in plan mode
- `askUserQuestion` is a blocking prerequisite before plan writing or auto-save
- plan mode starts with a stronger first clarification round, then asks smaller follow-ups only if the plan changes materially
- only the active plan file is writable in plan mode, and only after a clarification round completes
- `askUserQuestion` supports 1-4 clarifying questions with:
  - `Tab` / `Shift+Tab` question cycling
  - keyboard-first option selection
  - multi-select support (spacebar toggles the highlighted preset option)
  - optional `Extra details (optional)` free-text on top of preset choices
  - `My own thoughts` for a fully custom answer when presets do not fit
  - explicit option mappings like `A/1`, `B/2`, etc. in the saved clarification context
- plan storage is created on install at `~/.pi-constell/plans/`
- plans are exported to `~/.pi-constell/plans/`, completely outside the repo and never git-trackable by default
- Constellagent can discover PI Constell plans directly from `~/.pi-constell/plans/`
- saved plans use stronger action-oriented filenames such as:
  - `improve-plan-mode-questionnaire-ux.md`
  - `add-claude-style-ask-user-question.md`

## Install

```bash
pi install npm:pi-constell-plan
```

## Update

```bash
pi update
```

## Usage

### Manual plan mode

```bash
pi /plan
```

### Agent-requested switching

For planning-heavy prompts, the model can call `suggestPlanModeSwitch` while still in normal mode. The extension will:

- show a 15 second consent prompt
- switch only if the user accepts
- keep the current prompt in agent mode on decline/timeout
- suppress repeated plan-mode requests for that same prompt only
- immediately apply plan-mode rules after acceptance, even mid-turn

## What plan mode does

In plan mode pi will:

- investigate the repo with read-only tools before planning
- require `askUserQuestion` before the plan file becomes writable
- start with 3-4 strong clarification questions when needed, then use 1-2 focused follow-ups only when ambiguity remains
- prefer codebase inspection over asking when the answer is already discoverable in the repo
- let the model write or edit only the active plan file in `~/.pi-constell/plans/`
- preserve structured clarification context, including optional `Extra details` and explicit option mappings such as `A/1=...`
- allow read-only help commands while plan mode is active
- save Constellagent-compatible markdown plans with frontmatter
- write the full multi-phase plan now, even though later execution should still pause after phase 1 for approval
- keep the plan detailed enough to cover the required constraints and validation, but concise enough to stay readable
- generate concise phase-based plans with explicit validation sections and better saved filenames

## Prompt guidance for `suggestPlanModeSwitch`

The model should prefer `suggestPlanModeSwitch` for requests like:

- broad refactors
- architecture or workflow changes
- migrations
- ambiguous multi-file changes
- requests that obviously need phased planning, tradeoffs, or rollout decisions

The model should avoid it for:

- small direct edits
- single-file fixes
- typos, copy changes, or simple renames
- straightforward implementation tasks that do not need a planning pass

## `askUserQuestion` payload

```json
{
  "questions": [
    {
      "header": "Scope",
      "question": "What should this plan prioritize?",
      "multiSelect": false,
      "options": [
        { "label": "UX parity", "description": "Match Claude Code plan mode interactions closely." },
        { "label": "Fast publish", "description": "Minimize scope and ship to npm quickly." },
        { "label": "Hardening", "description": "Prioritize tests and guardrails first." }
      ]
    }
  ]
}
```

Users can always choose `My own thoughts` if none of the suggested options fit, or add `Extra details (optional)` alongside preset choices.
