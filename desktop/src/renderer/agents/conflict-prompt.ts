/**
 * Prompt for an in-terminal coding agent when `git push` after a Commit-triggered
 * commit hit a non-fast-forward and the auto fetch+rebase produced conflicts.
 *
 * The user-facing flow expects the agent to:
 *   - resolve each conflicted file
 *   - `git add` each one
 *   - `git rebase --continue` (repeat if more conflicts surface)
 *   - leave the worktree clean and notify in chat
 *   - NOT push (the user will re-click Commit to push)
 *   - NOT `git rebase --abort` unless the user asks
 */
export interface RebaseConflictPromptOptions {
  branch: string
  pushRemote: string
  pushRef: string
  conflictedFiles: string[]
}

export function formatRebaseConflictAgentPrompt(opts: RebaseConflictPromptOptions): string {
  const branch = opts.branch || '(unknown)'
  const remote = opts.pushRemote || 'origin'
  const ref = opts.pushRef || branch
  const filesBlock = opts.conflictedFiles.length > 0
    ? opts.conflictedFiles.map((f) => `- ${f}`).join('\n')
    : '- (no files reported by git status; run `git status` to inspect)'

  return [
    'You are resolving a Git rebase conflict that was started automatically by Constellagent.',
    '',
    'CONTEXT:',
    `- Local branch: ${branch}`,
    `- Push target: ${remote}/${ref}`,
    '- The user clicked Commit. The local commit succeeded, but `git push` was rejected as non-fast-forward.',
    '- Constellagent then ran `git fetch` and `git rebase FETCH_HEAD`, which is now paused with content conflicts.',
    '- The rebase is in progress on disk (`.git/rebase-merge/` exists).',
    '',
    'CONFLICTED FILES:',
    filesBlock,
    '',
    'WHAT TO DO:',
    '1. Inspect each conflicted file and resolve the conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).',
    '2. After resolving a file, run `git add <file>`.',
    '3. When all current conflicts are staged, run `git rebase --continue`.',
    '4. If more conflicts appear in a later commit, repeat steps 1–3.',
    '5. When `git status` shows the working tree is clean and no rebase is in progress, notify the user in chat that the rebase is complete and they can click Commit again to push.',
    '',
    'HARD RULES — do NOT do any of the following:',
    '- Do NOT run `git push` (the user pushes manually by re-clicking Commit).',
    '- Do NOT run `git rebase --abort` unless the user explicitly asks for it.',
    '- Do NOT amend the user’s commit, reset HEAD, or rewrite history beyond the in-progress rebase.',
    '- Do NOT change unrelated files. Only edit the conflicted regions.',
    '',
    'Success = all conflicts resolved, rebase completed cleanly, working tree clean, no push.',
  ].join('\n')
}
