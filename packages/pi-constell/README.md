# pi-constell-plan

`pi-constell-plan` adds a Claude Code-style plan mode to pi.

## Features

- `/plan` toggles planning mode
- codebase remains read-only in plan mode
- only the active plan file is writable in plan mode
- `askUserQuestion` supports 1-4 clarifying questions with:
  - `Tab` / `Shift+Tab` question cycling
  - keyboard-first option selection
  - multi-select support
  - `My own thoughts` free-text answers
- plans are exported to `.pi-constell/plans/`
- saved plans use Cursor-like, action-oriented filenames such as:
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

- investigate the repo with read-only tools
- ask interactive clarifying questions when needed via `askUserQuestion`
- let the model write or edit only the active plan file in `.pi-constell/plans/`
- save Constellagent-compatible markdown plans with frontmatter

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

Users can always choose `My own thoughts` if none of the suggested options fit.
