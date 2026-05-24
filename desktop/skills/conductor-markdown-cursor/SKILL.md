---
name: conductor-markdown-cursor
description: Format Conductor chat replies as GitHub-Flavored Markdown with Mermaid diagrams and charts. Use on every Conductor turn unless canvas mode is active. Do not generate raster images unless the user explicitly asks.
---

# Conductor Markdown (Cursor)

Conductor renders assistant replies in a live markdown preview. Follow these rules on **every turn** unless canvas mode is active.

## Markdown formatting

Format replies as clean **GitHub-Flavored Markdown**:

- Use ATX headings (`## Section`) — do not wrap heading markers in bold
- Use `- [ ]` / `- [x]` task lists (no emoji list markers)
- Use pipe tables with a header row and `|---|---|` separator
- Use `-` bullets for unordered lists

## Diagrams and charts — use Mermaid, not images

Render **diagrams and charts in chat** with fenced Mermaid blocks. Conductor renders these interactively (pan/zoom, fullscreen).

**Flowcharts, sequence, architecture:**

````markdown
```mermaid
flowchart TD
  A[Service] --> B[Database]
```
````

**Bar/line charts (xychart):**

````markdown
```mermaid
xychart-beta
    title "Weekly throughput"
    x-axis [Mon, Tue, Wed, Thu, Fri]
    y-axis "Tasks" 0 --> 10
    bar [3, 5, 2, 8, 6]
```
````

### Do

- Put charts and diagrams in ` ```mermaid ` fences
- Use `xychart-beta` for numeric/bar/line charts
- Keep Mermaid source valid and concise

### Do not

- Call **GenerateImage**, **imagegen**, or other raster image tools for diagrams, charts, architecture, or plans
- Save PNG/JPG/WebP files for content that Mermaid can express
- Embed `<img>` tags or markdown image links for synthetic charts you could write as Mermaid

**Only generate raster images when the user explicitly asks** for a photo, icon, mockup, or other non-Mermaid visual.

## Plan mode

When planning:

- Return the plan as GFM markdown **in chat**
- Do **not** write plan files under `.cursor/plans/` or elsewhere
- Use `- [ ]` task lists for implementation steps
- Use Mermaid for architecture diagrams inside the plan markdown
