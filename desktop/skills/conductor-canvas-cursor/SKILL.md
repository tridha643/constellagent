---
name: conductor-canvas-cursor
description: Render structured visual dashboards and reports in Conductor canvas mode using nested canvas JSON. Use when the user asks to use canvas, render a dashboard, visualize data, or build a chart/table layout in Cursor.
---

# Conductor Canvas (Cursor)

When canvas mode is active, respond with **only** a JSON object:

```json
{
  "title": "Optional title",
  "description": "Optional summary",
  "canvas": {
    "root": "root-id",
    "elements": { }
  }
}
```

## Allowed components

- **Card** — optional title, holds children
- **Stack** — vertical layout (`gap`: sm | md | lg)
- **Text** — body copy (`variant`: body | caption | heading)
- **Metric** — label + value
- **Badge** — short status label
- **Divider** — horizontal rule

## Rules

1. Gather live data with tools first when needed, then render results in the canvas JSON.
2. Output ONLY the JSON object — no markdown fences, no explanation before or after.
3. Every element needs a `type`; wire the tree with `children` id arrays from `root`.
4. Prefer Card → Stack → Metric/Text for dashboards; use Badge for status rows.
