# Project startup settings — test cases

## Automated e2e coverage

- IPC round-trip persists startup commands into the external hidden JSON file.
- Saving startup commands from the existing Project Settings modal writes the external file.
- Saved startup commands survive app relaunch with the same user-data directory.
- Legacy `project.startupCommands` values migrate into the external JSON on hydration.
- External JSON values override legacy persisted startup commands when both exist.
- New workspace creation uses external startup settings to create the expected startup tabs.
- Legacy-only startup tabs are not launched when external settings are present.

## Manual verification checklist

### External file behavior
- Verify the app creates `~/Desktop/.constellagent-project-settings.json` when saving startup commands.
- Verify the file remains outside the repo and `.git` storage.
- Verify the file stays hidden in Finder by default.
- Verify malformed JSON does not crash the app and the app recovers gracefully.

### Project Settings modal behavior
- Open Project Settings for a project with no startup commands and save a new command.
- Reopen the modal and confirm the saved command still appears.
- Add multiple commands and verify their order is preserved.
- Save a multiline command and verify it round-trips unchanged.
- Remove all commands, save, and verify the external entry is removed.

### Migration behavior
- Start from a legacy state file containing `project.startupCommands`.
- Launch the app and confirm the commands appear in Project Settings.
- Verify the external JSON now contains the migrated commands.
- Verify subsequent edits update the external JSON instead of relying on legacy state.

### Workspace startup behavior
- Create a new workspace from a project with configured startup commands.
- Verify each configured startup command opens its own terminal tab.
- Verify tab titles match configured command names.
- Verify a project with no startup commands still falls back to one blank terminal.
