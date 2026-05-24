// IPC channel constants shared between main and renderer

export const IPC = {
  // Git operations
  GIT_LIST_WORKTREES: 'git:list-worktrees',
  GIT_CREATE_WORKTREE: 'git:create-worktree',
  GIT_CREATE_WORKTREE_FROM_PR: 'git:create-worktree-from-pr',
  GIT_CREATE_WORKTREE_PROGRESS: 'git:create-worktree-progress',
  GIT_REMOVE_WORKTREE: 'git:remove-worktree',
  GIT_GET_STATUS: 'git:get-status',
  GIT_GET_DIFF: 'git:get-diff',
  GIT_GET_WORKTREE_DIFF: 'git:get-worktree-diff',
  GIT_GET_FILE_DIFF: 'git:get-file-diff',
  GIT_GET_BRANCHES: 'git:get-branches',
  GIT_STAGE: 'git:stage',
  GIT_STAGE_ALL: 'git:stage-all',
  GIT_UNSTAGE: 'git:unstage',
  GIT_DISCARD: 'git:discard',
  GIT_APPLY_HUNK_ACTION: 'git:apply-hunk-action',
  GIT_COMMIT: 'git:commit',
  GIT_PUSH_CURRENT_BRANCH: 'git:push-current-branch',
  GIT_PUSH_TO_PR_HEAD: 'git:push-to-pr-head',
  /** Fetch a remote ref then `git rebase FETCH_HEAD` — used to recover from non-fast-forward push rejections. */
  GIT_FETCH_AND_REBASE: 'git:fetch-and-rebase',
  /** Parse `git status --porcelain` for conflicted-file rows during an in-progress rebase/merge. */
  GIT_LIST_REBASE_CONFLICTS: 'git:list-rebase-conflicts',
  /** True when HEAD is ahead of `<remote>/<ref>` (used to enable Commit-as-push after an agent resolves a rebase). */
  GIT_IS_AHEAD_OF_REMOTE: 'git:is-ahead-of-remote',
  /** Switch to (or create) a branch inside a worktree, carrying uncommitted changes. */
  GIT_CHECKOUT_BRANCH: 'git:checkout-branch',
  GIT_GET_CURRENT_BRANCH: 'git:get-current-branch',
  GIT_GET_HEAD_HASH: 'git:get-head-hash',
  GIT_GET_DEFAULT_BRANCH: 'git:get-default-branch',
  GIT_SHOW_FILE_AT_HEAD: 'git:show-file-at-head',
  GIT_GET_LOG: 'git:get-log',
  GIT_GET_COMMIT_DIFF: 'git:get-commit-diff',
  /** Resolve `origin` default branch tip (`ls-remote origin HEAD`). */
  GIT_GET_REMOTE_HEAD: 'git:get-remote-head',
  GIT_SYNC_ALL_WORKTREES: 'git:sync-all-worktrees',
  /** Main → renderer: per-worktree sync status */
  GIT_WORKTREE_SYNC_STATUS: 'git:worktree-sync-status',
  /** Register project repo for manual worktree sync (sidebar); no background polling */
  GIT_START_SYNC_POLLING: 'git:start-sync-polling',
  GIT_STOP_SYNC_POLLING: 'git:stop-sync-polling',
  GIT_CHECK_IS_REPO: 'git:check-is-repo',
  /** Canonical project repo root, anchored at the primary checkout when possible. */
  GIT_GET_PROJECT_REPO_ANCHOR: 'git:get-project-repo-anchor',
  /** True when workspace root is a linked worktree (resolved path differs from main repo). */
  GIT_IS_SECONDARY_WORKTREE_ROOT: 'git:is-secondary-worktree-root',
  GIT_INIT_REPO: 'git:init-repo',
  GIT_CLONE_REPO: 'git:clone-repo',
  GIT_CLONE_REPO_PROGRESS: 'git:clone-repo-progress',
  GIT_CLONE_REPO_CANCEL: 'git:clone-repo-cancel',
  /** Renderer → main: worktree paths that have an active agent (busy for sync) */
  GIT_SYNC_SET_BUSY: 'git:sync-set-busy',

  // Graphite stack operations
  GRAPHITE_GET_STACK: 'graphite:get-stack',
  GRAPHITE_CHECKOUT_BRANCH: 'graphite:checkout-branch',
  GRAPHITE_CLONE_STACK: 'graphite:clone-stack',
  GRAPHITE_GET_STACK_FOR_PR: 'graphite:get-stack-for-pr',
  GRAPHITE_RUN_STACK_ACTION: 'graphite:run-stack-action',
  GRAPHITE_GET_CREATE_OPTIONS: 'graphite:get-create-options',
  GRAPHITE_SET_BRANCH_PARENT: 'graphite:set-branch-parent',

  // PTY operations
  PTY_CREATE: 'pty:create',
  PTY_WRITE: 'pty:write',
  PTY_RESIZE: 'pty:resize',
  PTY_DESTROY: 'pty:destroy',
  PTY_LIST: 'pty:list',
  PTY_REATTACH: 'pty:reattach',
  PTY_SNAPSHOT: 'pty:snapshot',
  PTY_DATA: 'pty:data', // prefix for events: `pty:data:{id}`
  PTY_TITLE_CHANGED: 'pty:title-changed',
  PTY_AGENT_DETECTED: 'pty:agent-detected',
  /** Main → renderer: PTY process exited; payload `{ ptyId, exitCode }`. Service tabs use this to flip status. */
  PTY_EXIT: 'pty:exit',
  /** Renderer → main: current input line on Enter (xterm often sends only \\r to PTY) */
  PTY_SUGGEST_TAB_TITLE: 'pty:suggest-tab-title',

  // File operations
  FS_GET_TREE: 'fs:get-tree',
  FS_GET_TREE_WITH_STATUS: 'fs:get-tree-with-status',
  FS_QUICK_OPEN_SEARCH: 'fs:quick-open-search',
  FS_CODE_SEARCH: 'fs:code-search',
  FS_SEARCH_AGENT_PLANS: 'fs:search-agent-plans',
  FS_READ_FILE: 'fs:read-file',
  FS_WRITE_FILE: 'fs:write-file',
  FS_DELETE_FILE: 'fs:delete-file',
  FS_WATCH_START: 'fs:watch-start',
  FS_WATCH_STOP: 'fs:watch-stop',
  FS_WATCH_CHANGED: 'fs:watch-changed',
  /** Newest .md/.mdx by mtime under agent plan dirs (e.g. .cursor/plans) */
  FS_FIND_NEWEST_PLAN: 'fs:find-newest-plan',
  /** All plan .md/.mdx files sorted newest-first with agent tag + meta */
  FS_LIST_AGENT_PLANS: 'fs:list-agent-plans',
  /** Read constellagent plan meta from YAML frontmatter (no disk write) */
  FS_READ_PLAN_META: 'fs:read-plan-meta',
  /** Update constellagent-namespaced YAML frontmatter on a plan .md */
  FS_UPDATE_PLAN_META: 'fs:update-plan-meta',
  /** Copy or move a plan file to a different agent's plan directory */
  FS_RELOCATE_AGENT_PLAN: 'fs:relocate-agent-plan',

  // App operations
  APP_SELECT_DIRECTORY: 'app:select-directory',
  APP_ADD_PROJECT_PATH: 'app:add-project-path',
  APP_OPEN_IN_EDITOR: 'app:open-in-editor',
  /** Node os.homedir() — for resolving ~/.claude/plans etc. in the renderer */
  APP_GET_HOME_DIR: 'app:get-home-dir',
  /** List available pi models from `pi --list-models` for PI Constell plan builds. */
  APP_LIST_PI_MODELS: 'app:list-pi-models',
  /** Generate a commit message from current uncommitted changes using PI. */
  APP_GENERATE_COMMIT_MESSAGE: 'app:generate-commit-message',
  /** Draft Linear issue title/body via Pi (optional worktree grounding). */
  APP_GENERATE_LINEAR_ISSUE_DRAFT: 'app:generate-linear-issue-draft',
  /** Draft Linear project update body via Pi. */
  APP_GENERATE_LINEAR_UPDATE_DRAFT: 'app:generate-linear-update-draft',
  /** Fully quit and relaunch the app (main + preload pick up rebuilds). */
  APP_RELAUNCH: 'app:relaunch',

  // Claude Code integration
  CLAUDE_TRUST_PATH: 'claude:trust-path',
  CLAUDE_INSTALL_HOOKS: 'claude:install-hooks',
  CLAUDE_UNINSTALL_HOOKS: 'claude:uninstall-hooks',
  CLAUDE_CHECK_HOOKS: 'claude:check-hooks',
  CLAUDE_NOTIFY_WORKSPACE: 'claude:notify-workspace',
  CLAUDE_ACTIVITY_UPDATE: 'claude:activity-update',
  CLAUDE_CONTEXT_WINDOW: 'claude:context-window',

  // Codex integration
  CODEX_INSTALL_NOTIFY: 'codex:install-notify',
  CODEX_UNINSTALL_NOTIFY: 'codex:uninstall-notify',
  CODEX_CHECK_NOTIFY: 'codex:check-notify',
  CODEX_GET_RATE_LIMITS: 'codex:get-rate-limits',
  CURSOR_GET_RATE_LIMITS: 'cursor:get-rate-limits',

  // Automation operations
  AUTOMATION_CREATE: 'automation:create',
  AUTOMATION_UPDATE: 'automation:update',
  AUTOMATION_DELETE: 'automation:delete',
  AUTOMATION_RUN_NOW: 'automation:run-now',
  AUTOMATION_STOP: 'automation:stop',
  AUTOMATION_RUN_STARTED: 'automation:run-started',
  AUTOMATION_STATUS_UPDATED: 'automation:status-updated',
  AUTOMATION_WORKSPACE_EVENT: 'automation:workspace-event',

  // GitHub operations
  GITHUB_GET_PR_STATUSES: 'github:get-pr-statuses',
  GITHUB_GET_PR_STATUSES_BY_NUMBER: 'github:get-pr-statuses-by-number',
  GITHUB_LIST_OPEN_PRS: 'github:list-open-prs',
  GITHUB_RESOLVE_PR: 'github:resolve-pr',
  GITHUB_CREATE_PR: 'github:create-pr',
  GITHUB_REOPEN_PR: 'github:reopen-pr',
  GITHUB_GET_PR_REVIEW_COMMENTS: 'github:get-pr-review-comments',
  GITHUB_CLONE_SUGGESTIONS: 'github:clone-suggestions',

  // LSP operations
  LSP_GET_PORT: 'lsp:get-port',
  LSP_GET_AVAILABLE_LANGUAGES: 'lsp:get-available-languages',

  // Clipboard operations
  CLIPBOARD_SAVE_IMAGE: 'clipboard:save-image',

  // MCP operations
  MCP_LOAD_SERVERS: 'mcp:load-servers',
  MCP_REMOVE_SERVER: 'mcp:remove-server',
  MCP_GET_CONFIG_PATHS: 'mcp:get-config-paths',

  // Session
  SESSION_GET_LAST: 'session:get-last',

  // Skills & Subagents
  SKILLS_SCAN: 'skills:scan',
  SUBAGENTS_SCAN: 'subagents:scan',

  // Skills & Subagents KV persistence (AgentFS-backed)
  SKILLS_KV_SAVE: 'skills:kv-save',
  SKILLS_KV_REMOVE: 'skills:kv-remove',
  SKILLS_KV_LIST: 'skills:kv-list',
  SUBAGENTS_KV_SAVE: 'subagents:kv-save',
  SUBAGENTS_KV_REMOVE: 'subagents:kv-remove',
  SUBAGENTS_KV_LIST: 'subagents:kv-list',

  // App file picker
  APP_SELECT_FILE: 'app:select-file',
  /** Open https URLs in the system browser (allowlisted hosts, e.g. Linear). */
  SHELL_OPEN_EXTERNAL: 'shell:open-external',
  /** Renderer → main: POST Linear GraphQL (avoids renderer CORS on api.linear.app). */
  LINEAR_GRAPHQL_REQUEST: 'linear:graphql-request',
  /** Linear Cmd+F: synthetic filesystem + FileFinder.fileSearch (see LinearFffService). */
  LINEAR_FFF_QUICK_OPEN: 'linear:fff-quick-open',

  // Review annotations (libSQL-backed, replaces hunk)
  REVIEW_COMMENT_ADD: 'review:comment-add',
  REVIEW_COMMENT_LIST: 'review:comment-list',
  REVIEW_COMMENT_REMOVE: 'review:comment-remove',
  REVIEW_COMMENT_CLEAR: 'review:comment-clear',
  REVIEW_COMMENT_RESOLVE: 'review:comment-resolve',
  /** Main → renderer: all annotations cleared after a PR merge */
  REVIEW_ANNOTATIONS_CLEARED: 'review:annotations-cleared',

  // Webview guest keyboard shortcuts (webview focus bypass)
  /** Renderer → main: register guest webContentsId for tab-switch interception */
  WEBVIEW_REGISTER_TAB_SWITCH: 'webview:register-tab-switch',
  /** Renderer → main: unregister guest webContentsId */
  WEBVIEW_UNREGISTER_TAB_SWITCH: 'webview:unregister-tab-switch',
  /** Main → renderer: switch to previous tab */
  WEBVIEW_TAB_PREV: 'webview:tab-prev',
  /** Main → renderer: switch to next tab */
  WEBVIEW_TAB_NEXT: 'webview:tab-next',

  // State persistence
  STATE_SAVE: 'state:save',
  STATE_SAVE_SYNC: 'state:save-sync',
  STATE_LOAD: 'state:load',

  // Per-terminal scrollback persistence (Track 6 — survives app restart)
  /** Renderer → main: load saved scrollback text for a tab id, or '' if none. */
  PTY_SCROLLBACK_LOAD: 'pty:scrollback:load',
  /** Renderer → main: save scrollback text for a tab id, capped to ~2 MB. */
  PTY_SCROLLBACK_SAVE: 'pty:scrollback:save',
  /** Renderer → main: delete the scrollback file when a tab is closed. */
  PTY_SCROLLBACK_DELETE: 'pty:scrollback:delete',

  // Package.json scripts discovery (Service tabs)
  /** Renderer → main: walk up from workingDir to nearest package.json, return its `scripts` map. */
  PACKAGE_SCRIPTS_LIST: 'package-scripts:list',

  // External project startup settings
  PROJECT_STARTUP_SETTINGS_LOAD_ALL: 'project-startup-settings:load-all',
  PROJECT_STARTUP_SETTINGS_GET: 'project-startup-settings:get',
  PROJECT_STARTUP_SETTINGS_SET: 'project-startup-settings:set',
  PROJECT_STARTUP_SETTINGS_DELETE: 'project-startup-settings:delete',
  PROJECT_STARTUP_SETTINGS_PATH: 'project-startup-settings:path',

  // Pi SDK (in-process agent UI; catalog + session data under app userData only)
  PI_GET_STATE: 'pi:get-state',
  PI_GET_SELECTED_TRANSCRIPT: 'pi:get-selected-transcript',
  PI_SYNC_WORKSPACE: 'pi:sync-workspace',
  PI_SELECT_SESSION: 'pi:select-session',
  PI_CREATE_SESSION: 'pi:create-session',
  PI_SUBMIT_COMPOSER: 'pi:submit-composer',
  PI_UPDATE_COMPOSER_DRAFT: 'pi:update-composer-draft',
  PI_CANCEL_CURRENT_RUN: 'pi:cancel-current-run',
  PI_SET_COMPOSER_ATTACHMENTS: 'pi:set-composer-attachments',
  PI_REMOVE_COMPOSER_ATTACHMENT: 'pi:remove-composer-attachment',
  PI_SET_SESSION_MODEL: 'pi:set-session-model',
  PI_SET_SESSION_THINKING_LEVEL: 'pi:set-session-thinking-level',
  /** Live Pi session context usage for the composer ring (`AgentSession.getContextUsage`). */
  PI_CONTEXT_USAGE: 'pi:context-usage',
  PI_RESPOND_HOST_UI: 'pi:respond-host-ui',
  PI_EXTENSION_TUI_INPUT: 'pi:extension-tui-input',
  /** Main → renderer */
  PI_STATE_CHANGED: 'pi:state-changed',
  PI_SELECTED_TRANSCRIPT_CHANGED: 'pi:selected-transcript-changed',

  // Conductor agent chat (Codex + Cursor drivers) — renderer → main
  AGENT_CHAT_CREATE_SESSION: 'agent-chat:create-session',
  AGENT_CHAT_FORK_SESSION: 'agent-chat:fork-session',
  AGENT_CHAT_LIST_SESSIONS: 'agent-chat:list-sessions',
  AGENT_CHAT_GET_SESSION: 'agent-chat:get-session',
  AGENT_CHAT_GET_CONTEXT_USAGE: 'agent-chat:get-context-usage',
  AGENT_CHAT_SUBMIT: 'agent-chat:submit',
  AGENT_CHAT_PICK_IMAGES: 'agent-chat:pick-images',
  AGENT_CHAT_REPLACE_QUEUE: 'agent-chat:replace-queue',
  AGENT_CHAT_SET_MODEL: 'agent-chat:set-model',
  AGENT_CHAT_SET_PLAN: 'agent-chat:set-plan',
  AGENT_CHAT_SET_CANVAS: 'agent-chat:set-canvas',
  AGENT_CHAT_SET_THINKING_LEVEL: 'agent-chat:set-thinking-level',
  AGENT_CHAT_CANCEL: 'agent-chat:cancel',
  AGENT_CHAT_RESPOND_BLOCKING_QUESTION: 'agent-chat:respond-blocking-question',
  AGENT_CHAT_DELETE_SESSION: 'agent-chat:delete-session',
  AGENT_CHAT_GET_AUTH_STATUS: 'agent-chat:get-auth-status',
  CONDUCTOR_AUTH_SYNC: 'conductor:auth-sync',
  // Conductor agent chat — main → renderer
  AGENT_CHAT_STATE_CHANGED: 'agent-chat:state-changed',
  AGENT_CHAT_TRANSCRIPT_CHANGED: 'agent-chat:transcript-changed',
  AGENT_CHAT_ASSISTANT_DELTA: 'agent-chat:assistant-delta',
  AGENT_CHAT_CONTEXT_CHANGED: 'agent-chat:context-changed',

  /** Composio webhooks + trigger API (main process). */
  COMPOSIO_WEBHOOK_STATUS: 'composio:webhook-status',
  COMPOSIO_WEBHOOK_APPLY_SETTINGS: 'composio:webhook-apply-settings',
  COMPOSIO_SUBSCRIBE_WEBHOOK: 'composio:subscribe-webhook',
  COMPOSIO_NGROK_STATUS: 'composio:ngrok-status',
  COMPOSIO_NGROK_START: 'composio:ngrok-start',
  COMPOSIO_NGROK_STOP: 'composio:ngrok-stop',
  COMPOSIO_UPSERT_TRIGGER: 'composio:upsert-trigger',
  COMPOSIO_PARSE_PI_DRAFT: 'composio:parse-pi-draft',
  COMPOSIO_SUGGEST_GITHUB_CONNECTED_ACCOUNT: 'composio:suggest-github-connected-account',
  COMPOSIO_LIST_AUTOMATION_DEFINITIONS: 'composio:list-automation-definitions',
  COMPOSIO_SET_AUTOMATION_DEFINITION_ENABLED: 'composio:set-automation-definition-enabled',
  COMPOSIO_SET_AUTOMATION_DEFINITION_INSTRUCTIONS: 'composio:set-automation-definition-instructions',
  COMPOSIO_SET_AUTOMATION_DEFINITION_AGENT: 'composio:set-automation-definition-agent',

  /** Spotlight testing: workspace → repo root one-way sync (Conductor-style). */
  SPOTLIGHT_ENABLE: 'spotlight:enable',
  SPOTLIGHT_DISABLE: 'spotlight:disable',
  SPOTLIGHT_GET_STATUS: 'spotlight:get-status',
  /** Main → renderer: per-project spotlight state machine transitions. */
  SPOTLIGHT_STATUS: 'spotlight:status',
} as const
