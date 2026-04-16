# pi-constell-plan

`pi-constell-plan` adds a Claude Code-style plan mode to pi. You enter plan mode explicitly with `pi --plan` or `/plan`; normal agent mode does not inject plan-mode prompts or a model-facing switch tool.

## Features

- `/plan` toggles planning mode manually
- `pi --plan` starts a session already in plan mode
- `/plan-off` and `/agent` leave planning mode explicitly
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

### Plan mode

```bash
pi --plan
```

Or toggle inside a session:

```bash
pi /plan
```

Use `/plan-off` or `/agent` to return to normal mode. Planning-heavy work should be done after you enable plan mode yourself; the extension does not prompt to switch from normal mode.

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
