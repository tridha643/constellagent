import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store/app-store'
import { parseGithubUrl, type ParsedGithubUrl } from '../../../shared/github-url'
import type { GithubCloneRepoSuggestion } from '../../../shared/github-clone-suggestions'
import {
  CLONE_ERROR_CODES,
  CLONE_REPO_STAGES,
  type CloneRepoProgressEvent,
  type CloneRepoStage,
} from '../../../shared/clone-repo'
import { useExitAnimation } from '../../hooks/useExitAnimation'
import { ADD_PROJECT_DIALOG_SEGMENT, type AddProjectDialogSegmentDetail } from '../../utils/add-project-dialog-segment'
import styles from './AddProjectDialog.module.css'

/** Match --motion-dialog-exit (see design-tokens.css). */
const EXIT_MS = 160

interface Props {
  onClose: () => void
}

type Tab = 'local' | 'clone'
type SuggestMode = 'mine' | 'search'

type View =
  | { kind: 'form' }
  | { kind: 'progress'; requestId: string; stage: CloneRepoStage; message: string; percent?: number }
  | { kind: 'error'; message: string; recoverable: boolean }

const STAGE_LABELS: Record<CloneRepoStage, string> = {
  'validate-url': 'Validate URL',
  'prepare-destination': 'Prepare destination',
  cloning: 'Clone repository',
  finalizing: 'Finalize',
}

function stageIndex(s: CloneRepoStage): number {
  return CLONE_REPO_STAGES.indexOf(s)
}

function friendlyCloneError(raw: string): { message: string; code: string | null } {
  switch (raw) {
    case CLONE_ERROR_CODES.AUTH_FAILED:
      return {
        message: 'Authentication required. Run `gh auth setup-git` or configure a git credential helper, then retry.',
        code: raw,
      }
    case CLONE_ERROR_CODES.NETWORK:
      return { message: 'Network error. Check your connection and retry.', code: raw }
    case CLONE_ERROR_CODES.NOT_FOUND:
      return { message: 'Repository not found. Check the URL and your access to it.', code: raw }
    case CLONE_ERROR_CODES.DEST_EXISTS_NON_EMPTY:
      return { message: 'The destination folder already exists and is not empty. Pick a different name.', code: raw }
    case CLONE_ERROR_CODES.DEST_EXISTS_REPO:
      return { message: 'A git repository already exists at that path.', code: raw }
    case CLONE_ERROR_CODES.CANCELLED:
      return { message: 'Clone cancelled.', code: raw }
    case CLONE_ERROR_CODES.INVALID_URL:
      return { message: 'Not a recognizable GitHub URL.', code: raw }
    default:
      return { message: raw || 'Failed to clone repository.', code: null }
  }
}

export function AddProjectDialog({ onClose }: Props) {
  const addProject = useAppStore((s) => s.addProject)
  const addToast = useAppStore((s) => s.addToast)
  const showConfirmDialog = useAppStore((s) => s.showConfirmDialog)
  const dismissConfirmDialog = useAppStore((s) => s.dismissConfirmDialog)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const lastClonedParentDir = useAppStore((s) => s.settings.lastClonedParentDir)

  const [open, setOpen] = useState(true)
  const { shouldRender, animating } = useExitAnimation(open, EXIT_MS)
  const exiting = animating === 'exit'

  const [tab, setTab] = useState<Tab>('local')
  const [view, setView] = useState<View>({ kind: 'form' })
  const [isBusy, setIsBusy] = useState(false)

  // Clone tab state
  const [urlInput, setUrlInput] = useState('')
  const [debouncedUrl, setDebouncedUrl] = useState('')
  const [folderName, setFolderName] = useState('')
  const [parentDir, setParentDir] = useState<string>('')
  const homeDirRef = useRef<string>('')

  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [suggestMode, setSuggestMode] = useState<SuggestMode>('mine')
  const [suggestions, setSuggestions] = useState<GithubCloneRepoSuggestion[]>([])
  const [suggestHighlight, setSuggestHighlight] = useState(0)
  const suggestRequestIdRef = useRef(0)
  const suggestRegionRef = useRef<HTMLDivElement>(null)
  const suggestListRef = useRef<HTMLUListElement>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)

  // Debounce URL validation to avoid flashing errors on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedUrl(urlInput), 150)
    return () => clearTimeout(id)
  }, [urlInput])

  const parsed: ParsedGithubUrl | null = useMemo(() => {
    if (!debouncedUrl.trim()) return null
    return parseGithubUrl(debouncedUrl)
  }, [debouncedUrl])

  const showUrlError = debouncedUrl.trim().length > 0 && parsed === null
  const cloneDisabled = !parsed || !folderName.trim() || !parentDir || isBusy

  // Keep folder name in sync with parsed URL (unless user edited it explicitly).
  const folderEditedRef = useRef(false)
  useEffect(() => {
    if (parsed && !folderEditedRef.current) {
      setFolderName(parsed.suggestedName)
    }
  }, [parsed])

  const closeSuggestions = useCallback(() => {
    suggestRequestIdRef.current += 1
    setSuggestOpen(false)
    setSuggestLoading(false)
  }, [])

  const openSuggestions = useCallback(() => {
    setSuggestOpen(true)
    urlInputRef.current?.focus()
  }, [])

  const loadRepoSuggestions = useCallback(async (q: string) => {
    const id = ++suggestRequestIdRef.current
    const trimmed = q.trim()
    const parsedQuery = trimmed ? parseGithubUrl(trimmed) : null
    const queryForApi = parsedQuery ? `${parsedQuery.owner}/${parsedQuery.name}` : trimmed
    const nextMode: SuggestMode = queryForApi ? 'search' : 'mine'

    setSuggestMode(nextMode)
    setSuggestLoading(true)
    setSuggestError(null)

    try {
      const rows = await window.api.github.listCloneRepoSuggestions(
        nextMode === 'mine' ? '' : queryForApi,
      )
      if (suggestRequestIdRef.current !== id) return

      const seen = new Set<string>()
      const nextSuggestions: GithubCloneRepoSuggestion[] = []
      const pushSuggestion = (row: GithubCloneRepoSuggestion) => {
        const key = row.fullName.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)
        nextSuggestions.push(row)
      }

      if (parsedQuery) {
        pushSuggestion({
          fullName: `${parsedQuery.owner}/${parsedQuery.name}`,
          webUrl: `https://github.com/${parsedQuery.owner}/${parsedQuery.name}`,
        })
      }
      rows.forEach(pushSuggestion)

      setSuggestions(nextSuggestions)
      setSuggestHighlight(0)
    } catch {
      if (suggestRequestIdRef.current !== id) return
      setSuggestions([])
      setSuggestError('GitHub suggestions are unavailable right now.')
    } finally {
      if (suggestRequestIdRef.current === id) setSuggestLoading(false)
    }
  }, [])

  // Debounce remote search; list your repos immediately when the panel opens.
  useEffect(() => {
    if (!suggestOpen) return
    const t = setTimeout(
      () => {
        void loadRepoSuggestions(urlInput)
      },
      urlInput.trim() ? 200 : 0,
    )
    return () => clearTimeout(t)
  }, [suggestOpen, urlInput, loadRepoSuggestions])

  useEffect(() => {
    if (tab !== 'clone') closeSuggestions()
  }, [closeSuggestions, tab])

  // Global `useShortcuts` runs in capture on `window` and owns ⌘←/→ and ⌥⌘←/→ for app tabs — it dispatches here instead.
  useEffect(() => {
    const onSegment = (ev: Event) => {
      if (view.kind !== 'form' || isBusy) return
      const d = (ev as CustomEvent<AddProjectDialogSegmentDetail>).detail
      if (!d) return
      setTab(d.direction === 'forward' ? 'clone' : 'local')
    }
    window.addEventListener(ADD_PROJECT_DIALOG_SEGMENT, onSegment)
    return () => window.removeEventListener(ADD_PROJECT_DIALOG_SEGMENT, onSegment)
  }, [isBusy, view.kind])

  useEffect(() => {
    if (!suggestOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (!suggestRegionRef.current?.contains(e.target as Node)) closeSuggestions()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [closeSuggestions, suggestOpen])

  useEffect(() => {
    if (!suggestOpen) return
    const el = suggestListRef.current?.children[suggestHighlight] as HTMLElement | undefined
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [suggestOpen, suggestHighlight, suggestions])

  // Load persisted / home dir on first mount.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const home = await window.api.app.getHomeDir().catch(() => '')
      if (cancelled) return
      homeDirRef.current = home
      setParentDir(lastClonedParentDir || home)
    }
    void load()
    return () => { cancelled = true }
    // lastClonedParentDir is read only on mount so switching tabs doesn't clobber an explicit pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const animateExit = useCallback(() => {
    if (isBusy) return
    setOpen(false)
  }, [isBusy])

  useEffect(() => {
    if (!shouldRender) onClose()
  }, [shouldRender, onClose])

  // ── Local folder tab ─────────────────────────────────────────────

  const handleChooseLocalFolder = useCallback(async () => {
    setIsBusy(true)
    try {
      const dirPath = await window.api.app.selectDirectory()
      if (!dirPath) {
        setIsBusy(false)
        return
      }
      const isRepo = await window.api.git.checkIsRepo(dirPath)
      const name = dirPath.split('/').pop() || dirPath
      const id = crypto.randomUUID()

      const commit = async () => {
        const repoPath = isRepo
          ? await window.api.git.getProjectRepoAnchor(dirPath).catch(() => dirPath)
          : dirPath
        addProject({ id, name, repoPath })
        setOpen(false)
      }

      if (!isRepo) {
        showConfirmDialog({
          title: 'Initialize Git Repository',
          message: `"${name}" is not a git repository. Initialize one to get started?`,
          confirmLabel: 'Initialize',
          onConfirm: async () => {
            dismissConfirmDialog()
            try {
              await window.api.git.initRepo(dirPath)
              await commit()
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Failed to initialize repo'
              addToast({ id: crypto.randomUUID(), message: msg, type: 'error' })
            } finally {
              setIsBusy(false)
            }
          },
        })
        // If user cancels the confirm dialog, the app store dismisses it; re-enable the button.
        setTimeout(() => setIsBusy(false), 0)
        return
      }

      await commit()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add project'
      addToast({ id: crypto.randomUUID(), message: msg, type: 'error' })
    } finally {
      setIsBusy(false)
    }
  }, [addProject, addToast, dismissConfirmDialog, showConfirmDialog])

  // ── Clone tab ────────────────────────────────────────────────────

  const handleChangeParentDir = useCallback(async () => {
    const dirPath = await window.api.app.selectDirectory()
    if (dirPath) setParentDir(dirPath)
  }, [])

  const registerClonedProject = useCallback(
    async (repoPath: string, name: string) => {
      const anchor = await window.api.git.getProjectRepoAnchor(repoPath).catch(() => repoPath)
      addProject({ id: crypto.randomUUID(), name, repoPath: anchor })
      if (parentDir) updateSettings({ lastClonedParentDir: parentDir })
    },
    [addProject, parentDir, updateSettings],
  )

  const handleStartClone = useCallback(async () => {
    if (!parsed || !folderName.trim() || !parentDir) return

    const requestId = crypto.randomUUID()
    const destPath = `${parentDir.replace(/\/+$/, '')}/${folderName.trim()}`

    setIsBusy(true)
    setView({ kind: 'progress', requestId, stage: 'validate-url', message: 'Starting…', percent: 0 })

    const unsubscribe = window.api.git.onCloneRepoProgress((progress: CloneRepoProgressEvent) => {
      if (progress.requestId !== requestId) return
      setView((current) => {
        if (current.kind !== 'progress' || current.requestId !== requestId) return current
        return {
          kind: 'progress',
          requestId,
          stage: progress.stage,
          message: progress.message,
          percent: progress.percent ?? current.percent,
        }
      })
    })

    try {
      const result = await window.api.git.cloneRepo({
        url: parsed.cloneUrl,
        destPath,
        requestId,
      })
      unsubscribe()
      await registerClonedProject(result.repoPath, parsed.name)
      addToast({
        id: crypto.randomUUID(),
        message: `Cloned ${parsed.owner}/${parsed.name}`,
        type: 'info',
      })
      // Hold on finalize tick for ~200ms so the eye registers success, then dismiss.
      setTimeout(() => setOpen(false), 200)
    } catch (err) {
      unsubscribe()
      const raw = err instanceof Error ? err.message : String(err)
      const friendly = friendlyCloneError(raw)

      // Fall-through: existing repo at destination → offer to add as local project.
      if (friendly.code === CLONE_ERROR_CODES.DEST_EXISTS_REPO) {
        showConfirmDialog({
          title: 'Folder already a git repo',
          message: `A repository already exists at "${destPath}". Add it as a project instead?`,
          confirmLabel: 'Add as project',
          onConfirm: async () => {
            dismissConfirmDialog()
            try {
              await registerClonedProject(destPath, parsed.name)
              addToast({
                id: crypto.randomUUID(),
                message: `Added ${parsed.owner}/${parsed.name}`,
                type: 'info',
              })
              setOpen(false)
            } catch (innerErr) {
              const msg = innerErr instanceof Error ? innerErr.message : 'Failed to add project'
              addToast({ id: crypto.randomUUID(), message: msg, type: 'error' })
            }
          },
        })
        setView({ kind: 'form' })
        setIsBusy(false)
        return
      }

      setView({
        kind: 'error',
        message: friendly.message,
        recoverable: friendly.code !== CLONE_ERROR_CODES.CANCELLED,
      })
    } finally {
      setIsBusy(false)
    }
  }, [
    addToast,
    dismissConfirmDialog,
    folderName,
    parentDir,
    parsed,
    registerClonedProject,
    showConfirmDialog,
  ])

  const handleCancelClone = useCallback(() => {
    if (view.kind !== 'progress') return
    window.api.git.cancelClone(view.requestId)
  }, [view])

  const handleBackToForm = useCallback(() => {
    setView({ kind: 'form' })
  }, [])

  const applySuggestion = useCallback((row: GithubCloneRepoSuggestion) => {
    setUrlInput(row.webUrl)
    folderEditedRef.current = false
    setSuggestError(null)
    closeSuggestions()
  }, [closeSuggestions])

  const handleUrlKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (tab !== 'clone') return
      if (!suggestOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          openSuggestions()
        }
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSuggestHighlight((h) => Math.min(h + 1, Math.max(suggestions.length - 1, 0)))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSuggestHighlight((h) => Math.max(h - 1, 0))
        return
      }
      if (e.key === 'Enter') {
        if (parseGithubUrl(e.currentTarget.value.trim())) {
          closeSuggestions()
          return
        }
        const pick = suggestions[suggestHighlight]
        if (pick) {
          e.preventDefault()
          e.stopPropagation()
          applySuggestion(pick)
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeSuggestions()
        return
      }
      if (e.key === 'Tab') {
        closeSuggestions()
      }
    },
    [applySuggestion, closeSuggestions, openSuggestions, suggestions, suggestHighlight, suggestOpen, tab],
  )

  // Key handling
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (suggestOpen) {
        e.preventDefault()
        closeSuggestions()
        return
      }
      if (view.kind === 'progress') handleCancelClone()
      else animateExit()
      return
    }
    if (e.key === 'Enter' && view.kind === 'form' && tab === 'clone' && !cloneDisabled) {
      e.preventDefault()
      void handleStartClone()
    }
  }, [animateExit, cloneDisabled, closeSuggestions, handleCancelClone, handleStartClone, suggestOpen, tab, view.kind])

  if (!shouldRender) return null

  const currentStageIdx = view.kind === 'progress' ? stageIndex(view.stage) : -1

  return (
    <div
      className={`${styles.overlay} constellagent-dialog-overlay ${exiting ? 'constellagent-dialog-overlay--exiting' : ''}`}
      onClick={animateExit}
    >
      <div
        className={`${styles.dialog} constellagent-dialog-body ${exiting ? 'constellagent-dialog-body--exiting' : ''}`}
        data-constellagent-add-project-dialog=""
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.title}>Add Project</div>

        {view.kind === 'form' && (
          <>
            <div className={styles.tabs} role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'local'}
                className={`${styles.tabBtn} ${tab === 'local' ? styles.tabActive : ''}`}
                onClick={() => setTab('local')}
                disabled={isBusy}
              >
                Local folder
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'clone'}
                className={`${styles.tabBtn} ${tab === 'clone' ? styles.tabActive : ''}`}
                onClick={() => setTab('clone')}
                disabled={isBusy}
              >
                Clone from GitHub
              </button>
            </div>

            {tab === 'local' ? (
              <div className={styles.panel}>
                <div className={styles.helpText}>
                  Pick an existing folder on your machine. If it isn't a git repo yet, you'll be
                  asked to initialize one.
                </div>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={animateExit}
                    disabled={isBusy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={handleChooseLocalFolder}
                    disabled={isBusy}
                  >
                    Choose folder…
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.panel}>
                <div className={styles.cloneUrlSection} ref={suggestRegionRef}>
                  <div className={styles.labelRow}>
                    <label className={styles.label} htmlFor="add-project-url">
                      GitHub URL
                    </label>
                    <button
                      type="button"
                      className={styles.suggestTrigger}
                      disabled={isBusy}
                      onClick={() => {
                        if (suggestOpen) closeSuggestions()
                        else openSuggestions()
                      }}
                      aria-expanded={suggestOpen}
                      aria-controls="add-project-url-suggestions"
                    >
                      {suggestOpen ? 'Hide' : 'Browse'}
                    </button>
                  </div>
                  <p className={styles.hint} id="add-project-url-hint">
                    Paste a repo link, <span className={styles.hintCode}>owner/repo</span>, or SSH. Browse shows your
                    repos first, then matching GitHub results.
                  </p>
                  <div className={styles.urlField}>
                    <input
                      id="add-project-url"
                      ref={urlInputRef}
                      className={`${styles.input} ${showUrlError ? styles.inputInvalid : ''}`}
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      placeholder="https://github.com/owner/repository"
                      autoFocus
                      autoComplete="off"
                      spellCheck={false}
                      role="combobox"
                      aria-expanded={suggestOpen}
                      aria-controls="add-project-url-suggestions"
                      aria-autocomplete="list"
                      aria-describedby="add-project-url-hint"
                      aria-activedescendant={
                        suggestOpen && suggestions.length > 0
                          ? `add-project-url-suggest-${suggestHighlight}`
                          : undefined
                      }
                      onFocus={() => {
                        if (suggestOpen) void loadRepoSuggestions(urlInput)
                      }}
                      onKeyDown={handleUrlKeyDown}
                    />
                    {suggestOpen && (
                      <div className={styles.suggestPopover}>
                        <div className={styles.suggestMeta}>
                          <span>{suggestMode === 'mine' ? 'Your GitHub repos' : 'Matching repositories'}</span>
                          <span className={styles.suggestMetaHint}>
                            {suggestLoading
                              ? 'Updating…'
                              : suggestions.length > 0
                                ? `${suggestions.length} shown`
                                : 'Nothing to show'}
                          </span>
                        </div>
                        <ul
                          id="add-project-url-suggestions"
                          className={styles.suggestList}
                          ref={suggestListRef}
                          role="listbox"
                          aria-label="GitHub repositories"
                        >
                          {suggestLoading && suggestions.length === 0 && (
                            <li className={styles.suggestStatus}>Loading GitHub suggestions…</li>
                          )}
                          {!suggestLoading && suggestError && (
                            <li className={styles.suggestStatus}>{suggestError}</li>
                          )}
                          {!suggestLoading && !suggestError && suggestions.length === 0 && (
                            <li className={styles.suggestStatus}>
                              {suggestMode === 'mine'
                                ? 'No repositories found. Run gh auth login in a terminal if needed.'
                                : 'No similar repositories found.'}
                            </li>
                          )}
                          {suggestions.map((s, i) => (
                            <li
                              key={s.fullName}
                              role="option"
                              id={`add-project-url-suggest-${i}`}
                              className={`${styles.suggestItem} ${i === suggestHighlight ? styles.suggestItemActive : ''}`}
                              aria-selected={i === suggestHighlight}
                              onMouseDown={(e) => e.preventDefault()}
                              onMouseEnter={() => setSuggestHighlight(i)}
                              onClick={() => applySuggestion(s)}
                            >
                              <span className={styles.suggestName}>{s.fullName}</span>
                              <span className={styles.suggestUrl}>{s.webUrl.replace(/^https?:\/\//, '')}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
                {parsed && (
                  <div className={styles.repoBadge} aria-live="polite">
                    <span>✓</span>
                    <span>
                      {parsed.owner}/{parsed.name}
                    </span>
                  </div>
                )}
                {showUrlError && (
                  <div className={styles.errorText} role="alert">
                    Not a recognizable GitHub URL.
                  </div>
                )}

                <label className={styles.label} htmlFor="add-project-folder">
                  Folder name
                </label>
                <input
                  id="add-project-folder"
                  className={styles.input}
                  value={folderName}
                  onChange={(e) => {
                    folderEditedRef.current = true
                    setFolderName(e.target.value)
                  }}
                  placeholder="repo-name"
                  autoComplete="off"
                  spellCheck={false}
                />

                <label className={styles.label}>Parent directory</label>
                <div className={styles.pathRow}>
                  <div className={styles.pathValue} title={parentDir}>
                    {parentDir || '…'}
                  </div>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={handleChangeParentDir}
                    disabled={isBusy}
                  >
                    Change…
                  </button>
                </div>

                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={animateExit}
                    disabled={isBusy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={handleStartClone}
                    disabled={cloneDisabled}
                  >
                    Clone
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {view.kind === 'progress' && (
          <div className={styles.progressPanel}>
            <div className={styles.stageList}>
              {CLONE_REPO_STAGES.map((s, idx) => {
                const state = idx < currentStageIdx ? 'done' : idx === currentStageIdx ? 'active' : 'idle'
                return (
                  <div
                    key={s}
                    className={`${styles.stageRow} ${state === 'active' ? styles.stageActive : ''} ${state === 'done' ? styles.stageDone : ''}`}
                  >
                    <span className={styles.stageIcon}>
                      {state === 'done' ? (
                        <span className={styles.stageIconDone} aria-label="Done">✓</span>
                      ) : state === 'active' ? (
                        <span className={styles.stageIconActive} aria-label="In progress" />
                      ) : (
                        <span className={styles.stageIconIdle} aria-label="Pending" />
                      )}
                    </span>
                    <span>{STAGE_LABELS[s]}</span>
                  </div>
                )
              })}
            </div>

            <div>
              <div className={styles.progressBarTrack} aria-hidden="true">
                <div
                  className={styles.progressBarFill}
                  style={{ transform: `scaleX(${Math.max(0, Math.min(100, view.percent ?? 0)) / 100})` }}
                />
              </div>
              <div className={styles.progressMeta}>
                <span>{STAGE_LABELS[view.stage]}</span>
                <span className={styles.pct}>{view.percent ?? 0}%</span>
              </div>
              <div className={styles.progressLog} title={view.message}>
                {view.message}
              </div>
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={handleCancelClone}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {view.kind === 'error' && (
          <div className={styles.errorPanel}>
            <div className={styles.errorMessage} role="alert">
              {view.message}
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={animateExit}
              >
                Close
              </button>
              {view.recoverable && (
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={handleBackToForm}
                >
                  Back
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
