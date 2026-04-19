import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLinearProjectPickerFff } from '../../hooks/useLinearProjectPickerFff'
import { fuzzyMatchSubsequence } from '../../linear/linear-jump-index'
import {
  formatLinearProjectRowSubtitle,
  linearFetchProjectDraftContext,
  linearOpenExternal,
  type LinearProjectNode,
  type LinearProjectUpdateNode,
  type LinearUserNode,
} from '../../linear/linear-api'
import { SendArrowIcon } from '../../pi-gui/icons'
import baseStyles from './LinearSearchComposer.module.css'
import ticketsStyles from './LinearTicketsComposer.module.css'
import { useFixedPopoverStyle } from './useFixedPopoverStyle'

function formatHealth(h?: string | null): string {
  if (!h) return ''
  if (h === 'onTrack') return 'On track'
  if (h === 'atRisk') return 'At risk'
  if (h === 'offTrack') return 'Off track'
  return h
}

function userLabel(u: LinearUserNode): string {
  return (u.displayName?.trim() || u.name || 'Unknown').trim()
}

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

export interface LinearSearchComposerProps {
  projects: LinearProjectNode[]
  scopeProjectId: string
  onScopeProjectIdChange: (id: string) => void
  pickerUsers: LinearUserNode[]
  orgUsersUnavailable: boolean
  scopeUserId: string
  onScopeUserIdChange: (id: string) => void
  projectUpdates: LinearProjectUpdateNode[]
  updatesLoading: boolean
  updatesError: string | null
  selectedProjectName?: string
  /** Branch / Graphite stack for the Workspace pill (this app’s open workspace). */
  workContextLabel: string
  /** Active workspace path for Pi git snapshot, or null */
  worktreePathForPi?: string | null
  /** API error from last submit (user-dismissed on edit). */
  submitError: string | null
  onClearSubmitError?: () => void
  onSubmitUpdate: (body: string) => Promise<boolean>
  /** Linear API key — used for native fff project filtering in the picker. */
  linearApiKey: string
}

export function LinearSearchComposer({
  projects,
  scopeProjectId,
  onScopeProjectIdChange,
  pickerUsers,
  orgUsersUnavailable,
  scopeUserId,
  onScopeUserIdChange,
  projectUpdates,
  updatesLoading,
  updatesError,
  selectedProjectName,
  workContextLabel,
  worktreePathForPi = null,
  submitError,
  onClearSubmitError,
  onSubmitUpdate,
  linearApiKey,
}: LinearSearchComposerProps) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [draftPiBusy, setDraftPiBusy] = useState(false)

  const [projectPopoverOpen, setProjectPopoverOpen] = useState(false)
  const [personPopoverOpen, setPersonPopoverOpen] = useState(false)
  const [pastPopoverOpen, setPastPopoverOpen] = useState(false)
  const [projectQuery, setProjectQuery] = useState('')
  const [personQuery, setPersonQuery] = useState('')

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const projectTriggerRef = useRef<HTMLButtonElement>(null)
  const personTriggerRef = useRef<HTMLButtonElement>(null)
  const pastTriggerRef = useRef<HTMLButtonElement>(null)
  const projectPopoverRef = useRef<HTMLDivElement>(null)
  const personPopoverRef = useRef<HTMLDivElement>(null)
  const pastPopoverRef = useRef<HTMLDivElement>(null)
  const projectSearchRef = useRef<HTMLInputElement>(null)
  const personSearchRef = useRef<HTMLInputElement>(null)

  const portalTarget = typeof document !== 'undefined' ? document.body : null

  const projectPopoverStyle = useFixedPopoverStyle(projectPopoverOpen, projectTriggerRef)
  const personPopoverStyle = useFixedPopoverStyle(personPopoverOpen, personTriggerRef)
  const pastPopoverStyle = useFixedPopoverStyle(
    pastPopoverOpen && Boolean(scopeProjectId),
    pastTriggerRef,
  )

  const sortedUsers = useMemo(
    () =>
      [...pickerUsers].sort((a, b) => {
        const an = userLabel(a).toLowerCase()
        const bn = userLabel(b).toLowerCase()
        return an.localeCompare(bn)
      }),
    [pickerUsers],
  )

  const projectBaseName =
    (scopeProjectId &&
      (projects.find((p) => p.id === scopeProjectId)?.name ?? selectedProjectName)) ||
    ''

  const projectPillLabel = projectBaseName ? projectBaseName : 'Choose project…'

  const pickedPerson = scopeUserId ? sortedUsers.find((u) => u.id === scopeUserId) : undefined
  const personBarLabel = pickedPerson ? userLabel(pickedPerson) : 'Anyone'

  const filteredProjects = useLinearProjectPickerFff(projects, projectQuery, linearApiKey)

  const filteredPeople = sortedUsers.filter((u) => {
    const q = personQuery.trim().toLowerCase()
    if (!q) return true
    const blob = `${userLabel(u)} ${u.name}`.toLowerCase()
    return fuzzyMatchSubsequence(q, blob) != null
  })

  const canSubmit = Boolean(scopeProjectId && body.trim() && !sending)

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 72), 220)}px`
  }, [body])

  useEffect(() => {
    if (!projectPopoverOpen) return
    const t = window.setTimeout(() => projectSearchRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [projectPopoverOpen])

  useEffect(() => {
    if (!personPopoverOpen) return
    const t = window.setTimeout(() => personSearchRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [personPopoverOpen])

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
      if (personPopoverOpen) {
        if (!personTriggerRef.current?.contains(t) && !personPopoverRef.current?.contains(t)) {
          setPersonPopoverOpen(false)
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
  }, [projectPopoverOpen, personPopoverOpen, pastPopoverOpen])

  const submit = useCallback(async () => {
    if (sending) return
    if (!scopeProjectId || !body.trim()) return
    setSending(true)
    try {
      const ok = await onSubmitUpdate(body)
      if (ok) setBody('')
    } finally {
      setSending(false)
    }
  }, [body, onSubmitUpdate, scopeProjectId, sending])

  const handleBodyChange = (v: string) => {
    setBody(v)
    onClearSubmitError?.()
  }

  const handleDraftWithPi = useCallback(async () => {
    if (draftPiBusy) return
    const name = projectBaseName.trim() || 'Project'
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
          console.warn('[LinearSearchComposer] project draft context fetch failed:', e)
        }
      }
      const { body: draftBody } = await window.api.app.generateLinearUpdateDraft({
        projectName: name,
        pastUpdates: projectUpdates
          .slice(0, 3)
          .map((u) => (u.body ?? '').trim())
          .filter(Boolean),
        worktreePath: worktreePathForPi,
        projectDescription,
        projectContentMarkdown,
      })
      setBody((b) => {
        if (!b.trim()) return draftBody
        return `${b}\n\n---\n${draftBody}`
      })
    } catch (e) {
      console.error('[LinearSearchComposer] draft with Pi failed:', e)
    } finally {
      setDraftPiBusy(false)
    }
  }, [draftPiBusy, linearApiKey, projectBaseName, projectUpdates, scopeProjectId, worktreePathForPi])

  return (
    <div
      className={`${baseStyles.shell} ${ticketsStyles.ticketsShell}`}
      data-testid="linear-search-composer"
    >
      <div className={`${baseStyles.composerSurface} ${ticketsStyles.ticketsComposerSurface}`}>
        <div className={ticketsStyles.inputLayerTickets}>
          <div className={ticketsStyles.ticketsTeamBar}>
            <div className={baseStyles.pillWrap}>
              <button
                type="button"
                ref={personTriggerRef}
                className={`${baseStyles.pillBtn} ${ticketsStyles.ticketsPill} ${ticketsStyles.ticketsPillTeam}`}
                aria-expanded={personPopoverOpen}
                aria-haspopup="listbox"
                title={orgUsersUnavailable ? 'People list from loaded issues.' : undefined}
                onClick={() => {
                  setPersonPopoverOpen((o) => !o)
                  setProjectPopoverOpen(false)
                  setPastPopoverOpen(false)
                  if (!personPopoverOpen) setPersonQuery('')
                }}
              >
                <span className={baseStyles.pillValue}>{personBarLabel}</span>
                <span className={baseStyles.pillChevron} aria-hidden>
                  ▾
                </span>
              </button>
              {personPopoverOpen && personPopoverStyle && portalTarget
                ? createPortal(
                    <div
                      ref={personPopoverRef}
                      className={`${baseStyles.popover} ${ticketsStyles.ticketsPopover}`}
                      style={
                        {
                          ...personPopoverStyle,
                          '--transform-origin': 'top left',
                        } as React.CSSProperties
                      }
                      role="listbox"
                      aria-label="Filter by person"
                    >
                      <input
                        ref={personSearchRef}
                        className={`${baseStyles.popoverSearch} ${ticketsStyles.ticketsPopoverSearch}`}
                        type="text"
                        value={personQuery}
                        placeholder="Filter people…"
                        onChange={(e) => setPersonQuery(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                      <div className={baseStyles.popoverList}>
                        <button
                          type="button"
                          role="option"
                          className={`${baseStyles.popoverItem} ${!scopeUserId ? baseStyles.popoverItemOn : ''}`}
                          onClick={() => {
                            onScopeUserIdChange('')
                            setPersonPopoverOpen(false)
                            setPersonQuery('')
                          }}
                        >
                          Anyone
                        </button>
                        {filteredPeople.length === 0 ? (
                          <div className={baseStyles.popoverEmpty}>No matching people.</div>
                        ) : (
                          filteredPeople.map((u) => (
                            <button
                              key={u.id}
                              type="button"
                              role="option"
                              className={`${baseStyles.popoverItem} ${scopeUserId === u.id ? baseStyles.popoverItemOn : ''}`}
                              onClick={() => {
                                onScopeUserIdChange(u.id)
                                setPersonPopoverOpen(false)
                                setPersonQuery('')
                              }}
                            >
                              <HighlightedFuzzyText text={userLabel(u)} query={personQuery} />
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

          <textarea
            ref={textareaRef}
            className={`${baseStyles.bodyInput} ${ticketsStyles.ticketsBody}`}
            placeholder="Share an update… (⌘↵ to send)"
            value={body}
            onChange={(e) => handleBodyChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void submit()
              }
            }}
            rows={6}
            data-testid="linear-composer-body"
          />

          <div className={`${baseStyles.pillStrip} ${ticketsStyles.ticketsPillStrip}`}>
            <div className={`${baseStyles.pillRow} ${ticketsStyles.ticketsPillRow}`}>
              <div className={baseStyles.pillWrap}>
                <button
                  type="button"
                  ref={projectTriggerRef}
                  className={`${baseStyles.pillBtn} ${ticketsStyles.ticketsPill} ${ticketsStyles.ticketsPillProject}`}
                  aria-expanded={projectPopoverOpen}
                  aria-haspopup="listbox"
                  onClick={() => {
                    setProjectPopoverOpen((o) => !o)
                    setPersonPopoverOpen(false)
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
                        className={`${baseStyles.popover} ${ticketsStyles.ticketsPopover}`}
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
                          className={`${baseStyles.popoverSearch} ${ticketsStyles.ticketsPopoverSearch}`}
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
                  className={`${baseStyles.pillBtn} ${baseStyles.pillStatic} ${ticketsStyles.ticketsPill} ${ticketsStyles.ticketsPillWorkspace}`}
                  role="status"
                  aria-label="Workspace and stack context"
                >
                  <span className={baseStyles.pillPrefix}>Workspace</span>
                  <span className={baseStyles.pillValue}>{workContextLabel}</span>
                </span>
              </div>

              {scopeProjectId ? (
                <div className={baseStyles.pillWrap}>
                  <button
                    type="button"
                    ref={pastTriggerRef}
                    className={`${baseStyles.pillBtn} ${ticketsStyles.ticketsPill}`}
                    aria-expanded={pastPopoverOpen}
                    aria-haspopup="dialog"
                    onClick={() => {
                      setPastPopoverOpen((o) => !o)
                      setProjectPopoverOpen(false)
                      setPersonPopoverOpen(false)
                    }}
                  >
                    {projectUpdates.length} past update{projectUpdates.length === 1 ? '' : 's'}
                  </button>
                  {pastPopoverOpen && pastPopoverStyle && portalTarget
                    ? createPortal(
                        <div
                          ref={pastPopoverRef}
                          className={`${baseStyles.popover} ${baseStyles.pastPopover} ${ticketsStyles.ticketsPopover}`}
                          style={
                            {
                              ...pastPopoverStyle,
                              '--transform-origin': 'top left',
                            } as React.CSSProperties
                          }
                        >
                          {updatesLoading ? (
                            <div className={baseStyles.popoverEmpty}>Loading updates…</div>
                          ) : updatesError ? (
                            <div className={baseStyles.popoverEmpty} title={updatesError}>
                              {updatesError}
                            </div>
                          ) : projectUpdates.length === 0 ? (
                            <div className={baseStyles.popoverEmpty}>No project updates from Linear.</div>
                          ) : (
                            <div
                              className={baseStyles.pastPopoverScroll}
                              role="list"
                              aria-label="Past project updates"
                            >
                              {projectUpdates.slice(0, 40).map((u, i) => {
                                const who = u.user?.displayName || u.user?.name || 'Unknown'
                                const when = new Date(u.createdAt).toLocaleString()
                                const h = formatHealth(u.health)
                                const preview = (u.body ?? '').trim().slice(0, 280)
                                const stagger = Math.min(i, 5)
                                return (
                                  <div
                                    key={u.id}
                                    role="listitem"
                                    className={baseStyles.pastItem}
                                    style={{ '--stagger': stagger } as React.CSSProperties}
                                  >
                                    <div className={baseStyles.updateMeta}>
                                      <span>{when}</span>
                                      <span>{who}</span>
                                      {h ? <span>{h}</span> : null}
                                    </div>
                                    {preview ? <div className={baseStyles.updateBody}>{preview}</div> : null}
                                    {u.url ? (
                                      <button
                                        type="button"
                                        className={baseStyles.updateLink}
                                        onClick={() => void linearOpenExternal(u.url)}
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
                  className={`${baseStyles.pillBtn} ${ticketsStyles.ticketsPill}`}
                  disabled={draftPiBusy}
                  title="Draft update body with Pi"
                  onClick={() => void handleDraftWithPi()}
                  data-testid="linear-composer-draft-pi"
                >
                  {draftPiBusy ? 'Drafting…' : 'Draft with Pi'}
                </button>
              </div>

              <div className={baseStyles.sendWrap}>
                <button
                  type="button"
                  className={`${baseStyles.sendBtn} ${ticketsStyles.ticketsSendBtn} ${sending ? baseStyles.sendBtnSending : ''}`}
                  disabled={!canSubmit}
                  aria-label="Post project update"
                  onClick={() => void submit()}
                  data-testid="linear-composer-send"
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
