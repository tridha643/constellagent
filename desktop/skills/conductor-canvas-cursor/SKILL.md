---
name: conductor-canvas-cursor
description: Render structured visual dashboards and reports in Conductor canvas mode using json-render inline generation (prose + SpecStream JSONL patches). Use when the user asks to use canvas, render a dashboard, visualize data, or build a chart/table layout in Cursor.
---

# Conductor Canvas (inline mode)

When canvas mode is active, use **json-render inline generation** ([docs](https://json-render.dev/docs/generation-modes)):

1. Reply conversationally when helpful (brief intro, context, or clarifications).
2. Then emit **SpecStream JSONL** — one RFC 6902 patch object per line ([streaming docs](https://json-render.dev/docs/streaming)).

Example:

```
Here's the updated dashboard:

{"op":"add","path":"/root","value":"card-1"}
{"op":"add","path":"/elements/card-1","value":{"type":"Card","props":{"title":"Revenue"},"children":["metric-1"]}}
{"op":"add","path":"/elements/metric-1","value":{"type":"Metric","props":{"label":"Total","value":"$100"}}}
```

## Allowed components

- **Card** — optional title, holds children
- **Stack** — vertical layout (`gap`: sm | md | lg)
- **Text** — body copy (`variant`: body | caption | heading)
- **Metric** — label + value
- **Badge** — short status label
- **Divider** — horizontal rule
- **Grid** — multi-column layout (`columns`, `gap`)
- **Heading** — semantic heading (`level`, `text`)
- **Button** — action button (`label`, `variant`)
- **Table** — tabular data (`columns`, `rows`)
- **Progress** — progress bar (`value`, `max`)
- **Alert** — status message (`title`, `description`, `variant`)

## Rules

1. Gather live data with tools first when needed, then render results as JSONL patches.
2. Do **not** output a single monolithic JSON blob — use patch lines so the UI can stream progressively.
3. Patch lines must be valid JSON objects with `op` and `path` (typically `"add"` into `/root` and `/elements/...`).
4. Prefer Card → Stack/Grid → Metric/Text/Badge/Table for dashboards.
5. Text-only replies are fine when no visual UI is needed.
