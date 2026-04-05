# Constellagent Cross-Agent Context

Shared instructions for all coding agents — session context, Cachebro, context database, and **hunk review comments** — are in **`AGENTS.md`** at the repository root.

**Hunk CLI skill:** upstream **[hunk-review](https://github.com/modem-dev/hunk/blob/main/skills/hunk-review/SKILL.md)** — installed into **`desktop/.claude/skills/hunk-review/SKILL.md`** by **`bun run setup`** or **`sh scripts/install-hunk-skill.sh`** (gitignored). The desktop app installs the **`hunk`** binary automatically when needed; see root **`AGENTS.md`**.

## Comment selection in Review Changes

Human comments in the Review Changes panel (Cmd+Shift+R) are individually selectable via checkboxes. Only **selected** human comments are included in the text submitted to the agent. AI-authored comments (those with an `author` field) are **non-toggleable** — they are display-only context in the diff and are never included in the submission text.

## Plan policies

1. **AI annotations in plans**: All plans must include AI annotation instructions — agents leave review comments on their own changes explaining rationale (`--author "<agent-name>"`).
2. **Verification loops**: Every plan must include a verification section with both automated tests (`bun run test`, specific test files) and manual test steps.
