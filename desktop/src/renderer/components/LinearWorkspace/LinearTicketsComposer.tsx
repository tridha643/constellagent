import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLinearProjectPickerFff } from '../../hooks/useLinearProjectPickerFff'
import { fuzzyMatchSubsequence } from '../../linear/linear-jump-index'
import {
  formatLinearProjectRowSubtitle,
  linearFetchProjectDraftContext,
  linearOpenExternal,
  type LinearIssueNode,
  type LinearProjectNode,
  type LinearTeamNode,
} from '../../linear/linear-api'
import { SendArrowIcon } from '../../pi-gui/icons'
import baseStyles from './LinearSearchComposer.module.css'
import styles from './LinearTicketsComposer.module.css'
import { useFixedPopoverStyle } from './useFixedPopoverStyle'

function HighlightedFuzzyText({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q) {
    return <span className={baseStyles.fuzzyPickName}>{text}</span>
  }
  const indices = new Set(fuzzyMatchSubsequence(q, text) ?? [])
  return (
    <span className={baseStyles.fuzzyPickName}>
      {text.split('').map((ch, index) =>
        indices.has(index) ? (
          <span key={index} className={baseStyles.fuzzyMatch}>
            {ch}
          </span>
        ) : (
          <span key={index}>{ch}</span>
        ),
      )}
    </span>
  )
}

const PRIORITY_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Urgent' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Medium' },
  { value: 4, label: 'Low' },
]

export interface LinearTicketsComposerProps {
  projects: LinearProjectNode[]
  scopeProjectId: string
  onScopeProjectIdChange: (id: string) => void
  selectedProjectName?: string
  /** Branch / Graphite stack line for the separate Workspace pill (this app’s open workspace). */
  workContextLabel: string
  teams: LinearTeamNode[]
  scopeTeamId: string
  onScopeTeamIdChange: (id: string) => void
  priority: number
  onPriorityChange: (p: number) => void
  ticketIssues: LinearIssueNode[]
  issuesLoading: boolean
  issuesError: string | null
  submitError: string | null
  onClearSubmitError?: () => void
  onSubmitTicket: (input: {
    title: string
    description: string
    teamId: string
    priority: number
  }) => Promise<boolean>
  /** Linear project display name for Pi grounding */
  projectNameForDraft: string
  /** Active workspace path for git snapshot, or null */
  worktreePathForPi: string | null
  /** Linear API key — used for native fff project filtering in the picker. */
  linearApiKey: string
}

export function LinearTicketsComposer({
  projects,
  scopeProjectId,
  onScopeProjectIdChange,
  selectedProjectName,
  workContextLabel,
  teams,
  scopeTeamId,
  onScopeTeamIdChange,
  priority,
  onPriorityChange,
  ticketIssues,
  issuesLoading,
  issuesError,
  submitError,
  onClearSubmitError,
  onSubmitTicket,
  projectNameForDraft,
  worktreePathForPi,
  linearApiKey,
}: LinearTicketsComposerProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [sending, setSending] = useState(false)
  const [draftPiBusy, setDraftPiBusy] = useState(false)

  const [projectPopoverOpen, setProjectPopoverOpen] = useState(false)
  const [teamPopoverOpen, setTeamPopoverOpen] = useState(false)
  const [priorityPopoverOpen, setPriorityPopoverOpen] = useState(false)
  const [pastPopoverOpen, setPastPopoverOpen] = useState(false)
  const [projectQuery, setProjectQuery] = useState('')
  const [teamQuery, setTeamQuery] = useState('')

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const projectTriggerRef = useRef<HTMLButtonElement>(null)
  const teamTriggerRef = useRef<HTMLButtonElement>(null)
  const priorityTriggerRef = useRef<HTMLButtonElement>(null)
  const pastTriggerRef = useRef<HTMLButtonElement>(null)
  const projectPopoverRef = useRef<HTMLDivElement>(null)
  const teamPopoverRef = useRef<HTMLDivElement>(null)
  const priorityPopoverRef = useRef<HTMLDivElement>(null)
  const pastPopoverRef = useRef<HTMLDivElement>(null)
  const projectSearchRef = useRef<HTMLInputElement>(null)
  const teamSearchRef = useRef<HTMLInputElement>(null)

  const portalTarget = typeof document !== 'undefined' ? document.body : null

  const projectPopoverStyle = useFixedPopoverStyle(projectPopoverOpen, projectTriggerRef)
  const teamPopoverStyle = useFixedPopoverStyle(teamPopoverOpen, teamTriggerRef)
  const priorityPopoverStyle = useFixedPopoverStyle(priorityPopoverOpen, priorityTriggerRef)
  const pastPopoverStyle = useFixedPopoverStyle(
    pastPopoverOpen && Boolean(scopeProjectId),
    pastTriggerRef,
  )

  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => a.name.localeCompare(b.name)),
    [teams],
  )

  const projectBaseName =
    (scopeProjectId &&
      (projects.find((p) => p.id === scopeProjectId)?.name ?? selectedProjectName)) ||
    ''

  const projectPillLabel = projectBaseName ? projectBaseName : 'Choose project…'

  const pickedTeam = scopeTeamId ? sortedTeams.find((t) => t.id === scopeTeamId) : undefined
  const teamLabel = pickedTeam ? `${pickedTeam.key} · ${pickedTeam.name}` : 'Choose team…'

  const priorityLabel = PRIORITY_OPTIONS.find((o) => o.value === priority)?.label ?? 'None'

  const filteredProjects = useLinearProjectPickerFff(projects, projectQuery, linearApiKey)

  const filteredTeams = sortedTeams.filter((t) => {
    const q = teamQuery.trim().toLowerCase()
    if (!q) return true
    const blob = `${t.key} ${t.name}`.toLowerCase()
    return fuzzyMatchSubsequence(q, blob) != null
  })

  const canSubmit = Boolean(
    scopeProjectId && scopeTeamId && title.trim() && !sending,
  )

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 72), 220)}px`
  }, [description])

  useEffect(() => {
    if (!projectPopoverOpen) return
    const t = window.setTimeout(() => projectSearchRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [projectPopoverOpen])

  useEffect(() => {
    if (!teamPopoverOpen) return
    const t = window.setTimeout(() => teamSearchRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [teamPopoverOpen])

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (projectPopoverOpen) {
        if (
          !projectTriggerRef.current?.contains(t)
          && !projectPopoverRef.current?.contains(t)
        ) {
          setProjectPopoverOpen(false)
        }
      }
      if (teamPopoverOpen) {
        if (!teamTriggerRef.current?.contains(t) && !teamPopoverRef.current?.contains(t)) {
          setTeamPopoverOpen(false)
        }
      }
      if (priorityPopoverOpen) {
        if (
          !priorityTriggerRef.current?.contains(t)
          && !priorityPopoverRef.current?.contains(t)
        ) {
          setPriorityPopoverOpen(false)
        }
      }
      if (pastPopoverOpen) {
        if (!pastTriggerRef.current?.contains(t) && !pastPopoverRef.current?.contains(t)) {
          setPastPopoverOpen(false)
        }
      }
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [projectPopoverOpen, teamPopoverOpen, priorityPopoverOpen, pastPopoverOpen])

  const submit = useCallback(async () => {
    if (sending) return
    if (!scopeProjectId || !scopeTeamId || !title.trim()) return
    setSending(true)
    try {
      const ok = await onSubmitTicket({
        title: title.trim(),
        description: description.trim(),
        teamId: scopeTeamId,
        priority,
      })
      if (ok) {
        setTitle('')
        setDescription('')
      }
    } finally {
      setSending(false)
    }
  }, [description, onSubmitTicket, priority, scopeProjectId, scopeTeamId, sending, title])

  const handleDescChange = (v: string) => {
    setDescription(v)
    onClearSubmitError?.()
  }

  const handleTitleChange = (v: string) => {
    setTitle(v)
    onClearSubmitError?.()
  }

  const handleDraftWithPi = useCallback(async () => {
    if (draftPiBusy) return
    setDraftPiBusy(true)
    try {
      let projectDescription: string | null | undefined
      let projectContentMarkdown: string | null | undefined
      if (scopeProjectId.trim() && linearApiKey.trim()) {
        try {
          const ctx = await linearFetchProjectDraftContext(linearApiKey, scopeProjectId)
          projectDescription = ctx.description ?? undefined
          projectContentMarkdown = ctx.contentMarkdown ?? undefined
        } catch (e) {
          console.warn('[LinearTicketsComposer] project draft context fetch failed:', e)
        }
      }
      const { title: dt, description: dd } =
        await window.api.app.generateLinearIssueDraft({
          projectName: projectNameForDraft.trim() || 'Project',
          worktreePath: worktreePathForPi,
          projectDescription,
          projectContentMarkdown,
        })
      setTitle((t) => (!t.trim() ? dt : t))
      setDescription((d) => {
        if (!d.trim()) return dd
        return `${d}\n\n---\n${dt}\n\n${dd}`
      })
    } catch (e) {
      console.error('[LinearTicketsComposer] draft with Pi failed:', e)
    } finally {
      setDraftPiBusy(false)
    }
  }, [draftPiBusy, linearApiKey, projectNameForDraft, scopeProjectId, worktreePathForPi])

  return (
    <div
      className={`${baseStyles.shell} ${styles.ticketsShell}`}
      data-testid="linear-tickets-composer"
    >
      <div className={`${baseStyles.composerSurface} ${styles.ticketsComposerSurface}`}>
        <div className={styles.inputLayerTickets}>
          <div className={styles.ticketsTeamBar}>
            <div className={baseStyles.pillWrap}>
              <button
                type="button"
                ref={teamTriggerRef}
                className={`${baseStyles.pillBtn} ${styles.ticketsPill} ${styles.ticketsPillTeam}`}
                aria-expanded={teamPopoverOpen}
                aria-haspopup="listbox"
                onClick={() => {
                  setTeamPopoverOpen((o) => !o)
                  setProjectPopoverOpen(false)
                  setPriorityPopoverOpen(false)
                  setPastPopoverOpen(false)
                  if (!teamPopoverOpen) setTeamQuery('')
                }}
              >
                <span className={baseStyles.pillValue}>{teamLabel}</span>
                <span className={baseStyles.pillChevron} aria-hidden>
                  ▾
                </span>
              </button>
              {teamPopoverOpen && teamPopoverStyle && portalTarget
                ? createPortal(
                    <div
                      ref={teamPopoverRef}
                      className={`${baseStyles.popover} ${styles.ticketsPopover}`}
                      style={
                        {
                          ...teamPopoverStyle,
                          '--transform-origin': 'top left',
                        } as React.CSSProperties
                      }
                      role="listbox"
                      aria-label="Choose team"
                    >
                      <input
                        ref={teamSearchRef}
                        className={`${baseStyles.popoverSearch} ${styles.ticketsPopoverSearch}`}
                        type="text"
                        value={teamQuery}
                        placeholder="Filter teams…"
                        onChange={(e) => setTeamQuery(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                      <div className={baseStyles.popoverList}>
                        {filteredTeams.length === 0 ? (
                          <div className={baseStyles.popoverEmpty}>No teams loaded.</div>
                        ) : (
                          filteredTeams.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              role="option"
                              className={`${baseStyles.popoverItem} ${scopeTeamId === t.id ? baseStyles.popoverItemOn : ''}`}
                              onClick={() => {
                                onScopeTeamIdChange(t.id)
                                setTeamPopoverOpen(false)
                                setTeamQuery('')
                              }}
                            >
                              <HighlightedFuzzyText text={`${t.key} · ${t.name}`} query={teamQuery} />
                            </button>
                          ))
                        )}
                      </div>
                    </div>,
                    portalTarget,
                  )
                : null}
            </div>
          </div>
          <input
            className={styles.titleInput}
            type="text"
            placeholder="Issue title"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void submit()
              }
            }}
            data-testid="linear-tickets-title"
          />
          <textarea
            ref={textareaRef}
            className={`${baseStyles.bodyInput} ${styles.ticketsBody}`}
            placeholder="Add description… (⌘↵ to send)"
            value={description}
            onChange={(e) => handleDescChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void submit()
              }
            }}
            rows={6}
            data-testid="linear-tickets-description"
          />
          <div className={`${baseStyles.pillStrip} ${styles.ticketsPillStrip}`}>
            <div className={`${baseStyles.pillRow} ${styles.ticketsPillRow}`}>
              <div className={baseStyles.pillWrap}>
                <button
                  type="button"
                  ref={projectTriggerRef}
                  className={`${baseStyles.pillBtn} ${styles.ticketsPill} ${styles.ticketsPillProject}`}
                  aria-expanded={projectPopoverOpen}
                  aria-haspopup="listbox"
                  onClick={() => {
                    setProjectPopoverOpen((o) => !o)
                    setTeamPopoverOpen(false)
                    setPriorityPopoverOpen(false)
                    setPastPopoverOpen(false)
                    if (!projectPopoverOpen) setProjectQuery('')
                  }}
                >
                  <span className={baseStyles.pillValue}>{projectPillLabel}</span>
                  <span className={baseStyles.pillChevron} aria-hidden>
                    ▾
                  </span>
                </button>
                {projectPopoverOpen && projectPopoverStyle && portalTarget
                  ? createPortal(
                      <div
                        ref={projectPopoverRef}
                        className={`${baseStyles.popover} ${styles.ticketsPopover}`}
                        style={
                          {
                            ...projectPopoverStyle,
                            '--transform-origin': 'top left',
                          } as React.CSSProperties
                        }
                        role="listbox"
                        aria-label="Choose project"
                      >
                        <input
                          ref={projectSearchRef}
                          className={`${baseStyles.popoverSearch} ${styles.ticketsPopoverSearch}`}
                          type="text"
                          value={projectQuery}
                          placeholder="Filter projects…"
                          onChange={(e) => setProjectQuery(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                        />
                        <p className={baseStyles.popoverWorkspaceHint}>
                          The Workspace pill shows this app&apos;s branch/stack. Linear team/org lines
                          are per project in the list.
                        </p>
                        <div className={baseStyles.popoverList}>
                          {filteredProjects.length === 0 ? (
                            <div className={baseStyles.popoverEmpty}>No matching projects.</div>
                          ) : (
                            filteredProjects.map((p) => {
                              const meta = formatLinearProjectRowSubtitle(p)
                              return (
                                <button
                                  key={p.id}
                                  type="button"
                                  role="option"
                                  className={baseStyles.popoverItem}
                                  onClick={() => {
                                    onScopeProjectIdChange(p.id)
                                    setProjectPopoverOpen(false)
                                    setProjectQuery('')
                                  }}
                                >
                                  <span className={baseStyles.projectPickLines}>
                                    <HighlightedFuzzyText text={p.name} query={projectQuery} />
                                    {meta ? (
                                      <span className={baseStyles.projectPickMeta}>{meta}</span>
                                    ) : null}
                                  </span>
                                </button>
                              )
                            })
                          )}
                        </div>
                      </div>,
                      portalTarget,
                    )
                  : null}
              </div>

              <div className={baseStyles.pillWrap}>
                <span
                  className={`${baseStyles.pillBtn} ${baseStyles.pillStatic} ${styles.ticketsPill} ${styles.ticketsPillWorkspace}`}
                  role="status"
                  aria-label="Workspace and stack context"
                >
                  <span className={baseStyles.pillPrefix}>Workspace</span>
                  <span className={baseStyles.pillValue}>{workContextLabel}</span>
                </span>
              </div>

              <div className={baseStyles.pillWrap}>
                <button
                  type="button"
                  ref={priorityTriggerRef}
                  className={`${baseStyles.pillBtn} ${styles.ticketsPill}`}
                  aria-expanded={priorityPopoverOpen}
                  aria-haspopup="listbox"
                  onClick={() => {
                    setPriorityPopoverOpen((o) => !o)
                    setProjectPopoverOpen(false)
                    setTeamPopoverOpen(false)
                    setPastPopoverOpen(false)
                  }}
                >
                  <span className={baseStyles.pillPrefix}>Priority</span>
                  <span className={baseStyles.pillValue}>{priorityLabel}</span>
                  <span className={baseStyles.pillChevron} aria-hidden>
                    ▾
                  </span>
                </button>
                {priorityPopoverOpen && priorityPopoverStyle && portalTarget
                  ? createPortal(
                      <div
                        ref={priorityPopoverRef}
                        className={`${baseStyles.popover} ${styles.ticketsPopover}`}
                        style={
                          {
                            ...priorityPopoverStyle,
                            '--transform-origin': 'top left',
                          } as React.CSSProperties
                        }
                        role="listbox"
                        aria-label="Priority"
                      >
                        <div className={baseStyles.popoverList}>
                          {PRIORITY_OPTIONS.map((o) => (
                            <button
                              key={o.value}
                              type="button"
                              role="option"
                              className={`${baseStyles.popoverItem} ${priority === o.value ? baseStyles.popoverItemOn : ''}`}
                              onClick={() => {
                                onPriorityChange(o.value)
                                setPriorityPopoverOpen(false)
                              }}
                            >
                              {o.label}
                            </button>
                          ))}
                        </div>
                      </div>,
                      portalTarget,
                    )
                  : null}
              </div>

              {scopeProjectId ? (
                <div className={baseStyles.pillWrap}>
                  <button
                    type="button"
                    ref={pastTriggerRef}
                    className={`${baseStyles.pillBtn} ${styles.ticketsPill}`}
                    aria-expanded={pastPopoverOpen}
                    aria-haspopup="dialog"
                    onClick={() => {
                      setPastPopoverOpen((o) => !o)
                      setProjectPopoverOpen(false)
                      setTeamPopoverOpen(false)
                      setPriorityPopoverOpen(false)
                    }}
                  >
                    {ticketIssues.length} past ticket{ticketIssues.length === 1 ? '' : 's'}
                  </button>
                  {pastPopoverOpen && pastPopoverStyle && portalTarget
                    ? createPortal(
                        <div
                          ref={pastPopoverRef}
                          className={`${baseStyles.popover} ${baseStyles.pastPopover} ${styles.ticketsPopover}`}
                          style={
                            {
                              ...pastPopoverStyle,
                              '--transform-origin': 'top left',
                            } as React.CSSProperties
                          }
                        >
                          {issuesLoading ? (
                            <div className={baseStyles.popoverEmpty}>Loading issues…</div>
                          ) : issuesError ? (
                            <div className={baseStyles.popoverEmpty} title={issuesError}>
                              {issuesError}
                            </div>
                          ) : ticketIssues.length === 0 ? (
                            <div className={baseStyles.popoverEmpty}>No issues for this project.</div>
                          ) : (
                            <div
                              className={baseStyles.pastPopoverScroll}
                              role="list"
                              aria-label="Past tickets"
                            >
                              {ticketIssues.slice(0, 40).map((issue, i) => {
                                const stagger = Math.min(i, 5)
                                return (
                                  <div
                                    key={issue.id}
                                    role="listitem"
                                    className={baseStyles.pastItem}
                                    style={{ '--stagger': stagger } as React.CSSProperties}
                                  >
                                    <div className={baseStyles.updateMeta}>
                                      <span>{issue.identifier}</span>
                                      <span>{issue.state?.name ?? '—'}</span>
                                    </div>
                                    <div className={baseStyles.updateBody}>{issue.title}</div>
                                    {issue.url ? (
                                      <button
                                        type="button"
                                        className={baseStyles.updateLink}
                                        onClick={() => void linearOpenExternal(issue.url)}
                                      >
                                        Open in Linear
                                      </button>
                                    ) : null}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>,
                        portalTarget,
                      )
                    : null}
                </div>
              ) : null}

              <div className={baseStyles.pillWrap}>
                <button
                  type="button"
                  className={`${baseStyles.pillBtn} ${styles.ticketsPill}`}
                  disabled={draftPiBusy}
                  title="Draft title and description with Pi"
                  onClick={() => void handleDraftWithPi()}
                  data-testid="linear-tickets-draft-pi"
                >
                  {draftPiBusy ? 'Drafting…' : 'Draft with Pi'}
                </button>
              </div>

              <div className={baseStyles.sendWrap}>
                <button
                  type="button"
                  className={`${baseStyles.sendBtn} ${styles.ticketsSendBtn} ${sending ? baseStyles.sendBtnSending : ''}`}
                  disabled={!canSubmit}
                  aria-label="Create ticket"
                  onClick={() => void submit()}
                  data-testid="linear-tickets-send"
                >
                  <span className={baseStyles.sendIcon} aria-hidden>
                    <SendArrowIcon />
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {submitError ? (
        <div className={baseStyles.inlineError} role="alert">
          {submitError}
        </div>
      ) : null}
    </div>
  )
}
