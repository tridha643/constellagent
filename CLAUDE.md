# Constellagent Cross-Agent Context

Shared instructions for all coding agents — session context, Cachebro, context database, and **review annotations** — are in **`AGENTS.md`** at the repository root.

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

**After implementing any code changes, agents MUST leave review annotations explaining their rationale on key changed lines.** This is not optional — it is a required step before considering work complete.

- Annotate **every source file you modified** with at least one comment on the most significant change (skip auto-generated files like `bun.lock`).
- Comments should explain **why** the change was made, not just restate what the code does.
- This step comes **after** a successful build but **before** reporting the task as done to the user.
- Failure to annotate is equivalent to leaving the task incomplete.

### Annotation workflow (exact steps)

```bash
# Single command — no session resolution, no daemon needed:
constell-annotate add --file src/foo.ts --new-line 42 --summary "Why this change" --author "claude-code"

# Line range:
constell-annotate add --file src/foo.ts --new-line 42-58 --summary "Refactored block" --author "claude-code"

# Force (skip diff validation):
constell-annotate add --file src/foo.ts --new-line 42 --summary "Why" --author "claude-code" --force
```

**Key point:** By default, `--new-line` must be inside a `git diff HEAD` hunk's new-side range. Use `--force` to skip validation when needed.
