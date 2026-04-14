# pi-constell-tasks

`pi-constell-tasks` is the implementation-time companion to `pi-constell-plan`.

It owns the native `Task*` tools, `/tasks`, shared task-store status, and startup-time context injection that lets a separate pi instance pick up a stored plan handoff from the same workspace.

## Features

- Exposes `TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`, `TaskOutput`, `TaskStop`, and `TaskExecute` in normal mode.
- Adds `/tasks` as the manual TUI task surface.
- Reads `~/.pi/<workspaceId>/tasks/handoff.json` to inject the stored plan reference on startup.
- Reads the shared workspace task graph from `~/.pi/<workspaceId>/tasks/tasks.json` by default.
- Supports `workspace`, `session`, and `memory` task scopes plus `autoCascade` and `autoClearCompleted` settings.
- Uses lock files with stale-lock recovery for file-backed task stores.

## Install

```bash
pi install npm:pi-constell-tasks
```

Use it together with the planner package when you want cross-instance pickup:

```bash
pi install npm:pi-constell-plan
pi install npm:pi-constell-tasks
```

## Workflow

1. Use `pi-constell-plan` in one pi instance to create and save a plan.
2. That save seeds `handoff.json` and, when the shared task graph is still empty, `tasks.json`.
3. Start another pi instance with `pi-constell-tasks` in the same worktree.
4. The task extension injects the stored plan reference plus current task summary, and `/tasks` and `Task*` tools are immediately available.

## Notes

- File-backed `workspace` scope is the supported handoff mode across pi instances.
- `session` and `memory` scopes are local convenience modes and are not durable handoff paths.
- If the stored `planPath` is missing, the extension still injects the reference and asks the agent to read the path directly if available.
