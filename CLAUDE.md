# Constellagent Cross-Agent Context

Shared instructions for all coding agents — session context, Cachebro, context database, and **hunk review comments** — are in **`AGENTS.md`** at the repository root.

**Hunk CLI skill:** upstream **[hunk-review](https://github.com/modem-dev/hunk/blob/main/skills/hunk-review/SKILL.md)** — installed into **`desktop/.claude/skills/hunk-review/SKILL.md`** by **`bun run setup`** or **`sh scripts/install-hunk-skill.sh`** (gitignored). The desktop app installs the **`hunk`** binary automatically when needed; see root **`AGENTS.md`**.

## Comment selection in Review Changes

Human comments in the Review Changes panel (Cmd+Shift+R) are individually selectable via checkboxes. Only **selected** human comments are included in the text submitted to the agent. AI-authored comments (those with an `author` field) are **non-toggleable** — they are display-only context in the diff and are never included in the submission text.

## Plan policies

1. **AI annotations in plans**: All plans must include AI annotation instructions — agents leave review comments on their own changes explaining rationale (`--author "<agent-name>"`).
2. **Verification loops**: Every plan must include a verification section with both automated tests (`bun run test`, specific test files) and manual test steps.
3. **Sendblue notifications**: Every plan must include the required Sendblue CLI notification step for both `plan created` and `task over`.

## Mandatory Sendblue CLI notifications

**Claude Code MUST send a Sendblue CLI notification to `+18258883809` when a plan is created and again when the task is over.**

```bash
sendblue send +18258883809 "claude-code <plan-topic-name> plan created"
sendblue send +18258883809 "claude-code <plan-topic-name> is over"
```

- Use the plan title for `<plan-topic-name>` when one exists; otherwise use a short task topic from the request.
- Retry each `sendblue send` command up to 3 times if it fails.
- If all retries fail, Claude Code must still say that explicitly in the final response and include the error text.
- The completion notification happens after build/test/annotation steps and before reporting the task as done to the user.

## Mandatory AI annotations on code changes

**After implementing any code changes, agents MUST leave hunk review comments explaining their rationale on key changed lines.** This is not optional — it is a required step before considering work complete.

- Annotate **every source file you modified** with at least one comment on the most significant change (skip auto-generated files like `bun.lock`).
- Comments should explain **why** the change was made, not just restate what the code does.
- This step comes **after** a successful build but **before** reporting the task as done to the user.
- Failure to annotate is equivalent to leaving the task incomplete.

### Annotation workflow (exact steps)

```bash
# 1. Resolve session ID for this repo
REPO="$(git rev-parse --show-toplevel)"
SID="$(hunk session list --json | jq -r --arg repo "$REPO" '[.sessions[] | select(.repoRoot == $repo)][0].sessionId // empty')"

# 2. Reload session so it sees your uncommitted changes
hunk session reload "$SID" -- diff

# 3. For each file, discover valid hunk line ranges BEFORE commenting.
#    --new-line MUST fall within a hunk's "New range" or the command fails.
#    Navigate to each hunk and read its range:
hunk session navigate "$SID" --file <path> --hunk 1
hunk session context "$SID"          # look at "New range: X..Y"

# 4. Add comments using a line within the reported New range:
hunk session comment add "$SID" \
  --file <path> --new-line <line-within-range> \
  --summary "<why this change was made>" \
  --author "claude-code"
```

**Key gotcha:** `--new-line` must be inside a diff hunk's new-side range. Arbitrary file line numbers that fall outside changed hunks will be rejected with "No new diff hunk covers line N". Always discover ranges first via `navigate` + `context`.
