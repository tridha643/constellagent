---
name: conductor-canvas-codex
description: Render structured visual dashboards and reports in Conductor canvas mode using flat JSON output (root + elementsJson). Use when the user asks to use canvas, render a dashboard, visualize data, or build a chart/table layout in Codex.
---

# Conductor Canvas (Codex)

When canvas mode is active, respond with **only** a JSON object validated by Codex structured output:

- `title` — dashboard title (empty string if none)
- `description` — one-line summary (empty string if none)
- `root` — id of the root element in the element map
- `elementsJson` — **stringified** JSON object mapping element ids to json-render nodes

## Element shape

Each entry in the parsed `elementsJson` map:

```json
{
  "type": "Card",
  "props": { "title": "Revenue" },
  "children": ["metric-1"]
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
2. Do not wrap the response in markdown fences or add prose outside the JSON object.
3. Keep `elementsJson` compact but valid JSON when stringified (escape quotes correctly).
4. Prefer Card → Stack → Metric/Text for dashboards; use Badge for status rows.
