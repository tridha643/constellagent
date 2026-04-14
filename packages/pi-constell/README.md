# pi-constell-plan

`pi-constell-plan` is the planning half of the split Constellagent pi workflow.

It owns plan-mode guardrails, clarifying-question flow, and plan export. When a plan is saved, it also seeds durable handoff metadata under `~/.pi/<workspaceId>/tasks/` so a separate implementation-time extension can pick the work up in another pi instance.

## Features

- `/plan` toggles planning mode.
- `/plan-off` and `/agent` exit planning mode explicitly.
- The codebase stays read-only in plan mode.
- `askUserQuestion` is a blocking prerequisite before plan writing or auto-save.
- Only the active plan file is writable in plan mode, and only after a clarification round completes.
- Plan files are written only under `~/.pi-constell/plans/`.
- Durable handoff files are written only under `~/.pi/<workspaceId>/tasks/`.
- Saved plans use stronger action-oriented filenames such as `improve-plan-mode-questionnaire-ux.md`.

## Install

```bash
pi install npm:pi-constell-plan
```

Install the companion task extension when you want implementation-time pickup:

```bash
pi install npm:pi-constell-tasks
```

## Usage

```bash
pi /plan
```

Use `pi /plan-off` or `pi /agent` to leave plan mode before handing control to an implementation-focused pi instance.

In plan mode pi will:

- Investigate the repo with read-only tools before planning.
- Require `askUserQuestion` before the plan file becomes writable.
- Ask an initial 3-4 question clarification batch after repo investigation, then smaller 1-2 question follow-ups when the plan changes materially.
- Prefer codebase inspection over asking when the answer is already discoverable in the repo.
- Let the model write or edit only the active plan file in `~/.pi-constell/plans/`.
- Preserve structured clarification context, including optional `Extra details`.
- Save Constellagent-compatible markdown plans with frontmatter.
- Seed a durable handoff manifest and an initial phase-derived task graph under `~/.pi/<workspaceId>/tasks/`.

## Handoff Contract

When `AGENT_ORCH_WS_ID` is available, saving a plan writes:

- `~/.pi/<workspaceId>/tasks/handoff.json` with the saved plan reference and seed metadata.
- `~/.pi/<workspaceId>/tasks/tasks.json` when the shared workspace task graph is still empty.

The plan package does not own `Task*` tools or `/tasks`. Those live in `pi-constell-tasks`, which reads the stored handoff contract in a later implementation session.

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
