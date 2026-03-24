# Agent plans in this workspace

Constellagent discovers plan markdown from the **workspace root** you add in the app (this folder’s parent is the worktree). The sidebar **Plans** action and **⇧⌘M** palette scan these directories **under the workspace** and the **same relative paths under your user home directory** (so Claude Code plans created at `~/.claude/plans/*.md` appear in the palette).

| Agent        | Relative path        |
|-------------|----------------------|
| Cursor      | `.cursor/plans`      |
| Claude Code | `.claude/plans`      |
| Codex       | `.codex/plans`       |
| Gemini CLI  | `.gemini/plans`      |

Use `.md` or `.mdx` files anywhere under those trees.

**Monorepo:** If you open `desktop/` as the workspace, plans must live under `desktop/.codex/plans` (and siblings), not only at the git repository root. Open the repo root as the workspace if you want plans next to the top-level `package.json`.
