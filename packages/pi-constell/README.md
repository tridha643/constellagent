# pi-constell-plan

`pi-constell-plan` adds a Claude Code-style plan mode to pi.

## Features

- `/plan` toggles planning mode
- codebase remains read-only in plan mode
- `askUserQuestion` is a blocking prerequisite before plan writing or auto-save
- plan mode asks clarifying questions one at a time before drafting the plan
- only the active plan file is writable in plan mode, and only after a clarification round completes
- `askUserQuestion` supports 1-4 clarifying questions with:
  - `Tab` / `Shift+Tab` question cycling
  - keyboard-first option selection
  - multi-select support (spacebar toggles the highlighted preset option)
  - optional `Extra details (optional)` free-text on top of preset choices
  - `My own thoughts` for a fully custom answer when presets do not fit
- plan storage is created on install at `~/.pi-constell/plans/`
- plans are exported to `~/.pi-constell/plans/`, completely outside the repo and never git-trackable by default
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

```bash
pi /plan
```

In plan mode pi will:

- investigate the repo with read-only tools before planning
- require `askUserQuestion` before the plan file becomes writable
- ask follow-up questions one at a time until ambiguities are resolved
- prefer codebase inspection over asking when the answer is already discoverable in the repo
- let the model write or edit only the active plan file in `~/.pi-constell/plans/`
- preserve structured clarification context, including optional `Extra details`
- save Constellagent-compatible markdown plans with frontmatter
- generate concise PR-stack style plans with explicit validation sections and better saved filenames

## askUserQuestion payload

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
