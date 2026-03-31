# Automations Verification Loop

Run the repeatable loop first:

```bash
bun run verify:automations
```

That covers:

1. Production build
2. Headless smoke coverage for:
   - `workspace:created` -> `run-shell-command`
   - manual -> `write-to-pty`
   - cooldown suppression
   - notification dispatch

Optional full-app Electron coverage:

```bash
bun run test:automations:e2e
```

Then run this manual smoke pass in a dev build:

```bash
bun run dev
```

## Manual Smoke

1. Create a repo-backed project and open the Automations panel.
2. Create a cron automation with `Run Prompt`, save it, toggle it off/on, and confirm it still appears correctly after reload.
3. Create an `agent:stopped` automation filtered to `claude-code` with a `Shell Command` action, stop a Claude session, and confirm the command fires once.
4. Trigger the same event twice within the cooldown window and confirm the action only fires once.
5. Create an `agent:tool-used` automation filtered to a known tool name and confirm it fires only for that tool.
6. Create a `workspace:created` automation with `Notification`, add a workspace, and confirm the notification appears.
7. Create a manual `write-to-pty` automation for a live workspace, click `Run`, and confirm the terminal receives the input.
8. If the repo has GitHub PR state available, create a `pr:checks-failed` automation and confirm it fires on a failing transition.

## Exit Criteria

- Build passes.
- `e2e/automations.spec.ts` passes.
- Existing cron automations still schedule.
- At least one event-driven automation fires end-to-end in the live app.
- Cooldown suppresses duplicate runs.
