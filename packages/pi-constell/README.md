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
  - optional `Extra details / image paths (optional)` free-text on top of preset choices
  - path-based screenshot references in details (desktop image paste saves clipboard images to a temp `.png` path)
  - `My own thoughts` for a fully custom answer when presets do not fit
- plans are exported to `.pi-constell/plans/`
- newly created plan files are kept local-only by adding `.pi-constell/plans/` to `.git/info/exclude` automatically
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

- investigate the repo with read-only tools before planning
- require `askUserQuestion` before the plan file becomes writable
- ask follow-up questions one at a time until ambiguities are resolved
- prefer codebase inspection over asking when the answer is already discoverable in the repo
- let the model write or edit only the active plan file in `.pi-constell/plans/`
- preserve structured clarification context, including pasted image file paths in question details
- save Constellagent-compatible markdown plans with frontmatter
- generate concise PR-stack style plans with explicit validation sections

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

When visual context helps, users can open `Extra details / image paths (optional)` and paste either:
- a saved image path directly, or
- a clipboard image in the desktop app, which is converted into a temp `.png` path and pasted into the active terminal input.

If a repository already tracks files under `.pi-constell/plans`, untrack them once with `git rm --cached .pi-constell/plans/*.md` so future plan writes stay local-only.
