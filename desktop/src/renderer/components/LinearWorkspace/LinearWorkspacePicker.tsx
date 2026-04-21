import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  useLinearWorkspacePickerFff,
  type LinearWorkspacePickerRow,
} from '../../hooks/useLinearWorkspacePickerFff'
import { fuzzyMatchSubsequence } from '../../linear/linear-jump-index'
import { useAppStore } from '../../store/app-store'
import baseStyles from './LinearSearchComposer.module.css'
import { formatLinearWorkContextLabel } from './format-linear-work-context'
import { useFixedPopoverStyle } from './useFixedPopoverStyle'

function slugSegment(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'item'
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

export interface LinearWorkspacePickerProps {
  pillClassName?: string
}

export function LinearWorkspacePicker({
  pillClassName,
}: LinearWorkspacePickerProps) {
  const projects = useAppStore((s) => s.projects)
  const workspaces = useAppStore((s) => s.workspaces)
  const graphiteStacks = useAppStore((s) => s.graphiteStacks)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace)
  const resolveProjectTargetWorkspace = useAppStore((s) => s.resolveProjectTargetWorkspace)

  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [query, setQuery] = useState('')

  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const portalTarget = typeof document !== 'undefined' ? document.body : null
  const popoverStyle = useFixedPopoverStyle(open || mounted, triggerRef, { minWidthPx: 320 })

  /** Keep popover mounted through exit transition so @starting-style + transition can animate out. */
  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    if (!mounted) return
    const timer = window.setTimeout(() => setMounted(false), 180)
    return () => window.clearTimeout(timer)
  }, [open, mounted])

  const popoverTransformOrigin = useMemo(() => {
    if (!popoverStyle || !triggerRef.current) return 'top left'
    const triggerRect = triggerRef.current.getBoundingClientRect()
    const popoverTop = Number(popoverStyle.top ?? 0)
    const isBelow = popoverTop >= triggerRect.bottom - 4
    return isBelow ? 'top left' : 'bottom left'
  }, [popoverStyle])

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name] as const)),
    [projects],
  )

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  )

  const activeContextLabel = useMemo(() => {
    if (!activeWorkspace) return 'no workspace'
    return formatLinearWorkContextLabel(
      activeWorkspace.branch,
      graphiteStacks.get(activeWorkspace.id) ?? null,
    )
  }, [activeWorkspace, graphiteStacks])

  const orderedRows = useMemo<LinearWorkspacePickerRow[]>(() => {
    const activeIndex = workspaces.findIndex((workspace) => workspace.id === activeWorkspaceId)
    const rotated =
      activeIndex > 0
        ? [...workspaces.slice(activeIndex), ...workspaces.slice(0, activeIndex)]
        : workspaces

    const rows: LinearWorkspacePickerRow[] = []

    for (const workspace of rotated) {
      const projectName = projectNameById.get(workspace.projectId)?.trim() || 'Project'
      const stack = graphiteStacks.get(workspace.id) ?? null
      const contextLabel = formatLinearWorkContextLabel(workspace.branch, stack)
      const stackBranches = stack?.branches
        .map((branch) => branch.name.trim())
        .filter(Boolean) ?? []
      const title = workspace.name.trim() || contextLabel
      const stackSummary =
        stackBranches.length > 1
          ? `${stackBranches.length}-branch stack`
          : stackBranches.length === 1
            ? 'Graphite branch'
            : 'Workspace'
      const subtitle = [projectName, contextLabel, stackSummary].filter(Boolean).join(' · ')
      const searchTerms = [
        title,
        workspace.name,
        workspace.branch,
        workspace.worktreePath,
        projectName,
        contextLabel,
        stack?.currentBranch,
        ...stackBranches,
        'workspace',
        'graphite',
        'stack',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      const fffRelativePath = [
        slugSegment(projectName),
        slugSegment(title),
        slugSegment(contextLabel),
        ...stackBranches.map((branch) => slugSegment(branch)),
        `ws-${workspace.id}`,
      ].join('/')

      rows.push({
        id: workspace.id,
        kind: 'workspace',
        title,
        subtitle,
        searchBlob: searchTerms,
        fffRelativePath,
        targetWorkspaceId: workspace.id,
      })

      for (const branchName of stackBranches) {
        rows.push({
          id: `${workspace.id}:stack:${branchName}`,
          kind: 'stack-branch',
          title: branchName,
          subtitle: `${title} · ${projectName} · Graphite stack`,
          searchBlob: [
            branchName,
            title,
            workspace.name,
            workspace.branch,
            projectName,
            contextLabel,
            ...stackBranches,
            'graphite stack branch',
          ].join(' ').toLowerCase(),
          fffRelativePath: [
            slugSegment(projectName),
            'graphite-stack',
            slugSegment(branchName),
            slugSegment(title),
            `stack-${workspace.id}`,
          ].join('/'),
          targetWorkspaceId: workspace.id,
        })
      }
    }

    for (const project of projects) {
      const targetWorkspace = resolveProjectTargetWorkspace(project.id)
      if (!targetWorkspace) continue
      rows.push({
        id: `project:${project.id}`,
        kind: 'project',
        title: project.name.trim() || 'Project',
        subtitle: `${targetWorkspace.name} · Project`,
        searchBlob: [
          project.name,
          project.repoPath,
          targetWorkspace.name,
          targetWorkspace.branch,
          'project workspace',
        ].join(' ').toLowerCase(),
        fffRelativePath: [
          'project',
          slugSegment(project.name),
          slugSegment(targetWorkspace.name),
          `project-${project.id}`,
        ].join('/'),
        targetWorkspaceId: targetWorkspace.id,
      })
    }

    return rows
  }, [
    workspaces,
    activeWorkspaceId,
    projectNameById,
    graphiteStacks,
    projects,
    resolveProjectTargetWorkspace,
  ])

  const filteredRows = useLinearWorkspacePickerFff(orderedRows, query)

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDocDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const triggerClasses = [baseStyles.pillBtn, baseStyles.pillWorkspace, pillClassName]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={baseStyles.pillWrap}>
      <button
        type="button"
        ref={triggerRef}
        className={triggerClasses}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Choose workspace"
        title={activeWorkspace ? `${activeWorkspace.name} · ${activeContextLabel}` : 'Choose workspace'}
        data-testid="linear-workspace-picker-trigger"
        onClick={() => {
          setOpen((wasOpen) => !wasOpen)
          if (!open) setQuery('')
        }}
      >
        <span className={baseStyles.pillPrefix}>Workspace</span>
        <span className={baseStyles.pillValue}>{activeContextLabel}</span>
        <span className={baseStyles.pillChevron} aria-hidden>
          ▾
        </span>
      </button>

      {mounted && popoverStyle && portalTarget
        ? createPortal(
            <div
              ref={popoverRef}
              className={baseStyles.popover}
              data-state={open ? 'open' : 'closed'}
              style={
                {
                  ...popoverStyle,
                  '--transform-origin': popoverTransformOrigin,
                } as CSSProperties
              }
              role="listbox"
              aria-label="Choose workspace"
            >
              <input
                ref={searchRef}
                className={baseStyles.popoverSearch}
                type="text"
                value={query}
                placeholder="Search projects, workspaces, and stacks…"
                data-testid="linear-workspace-picker-input"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
              />
              <p className={baseStyles.popoverWorkspaceHint}>
                Search local projects, open workspaces, and Graphite stack branches with fff.
              </p>
              <div className={baseStyles.popoverList}>
                {filteredRows.length === 0 ? (
                  <div className={baseStyles.popoverEmpty}>No matching workspaces.</div>
                ) : (
                  filteredRows.map((row) => {
                    const isActive = row.targetWorkspaceId === activeWorkspaceId
                    return (
                      <button
                        key={row.id}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        className={`${baseStyles.popoverItem} ${isActive ? baseStyles.popoverItemOn : ''}`}
                        onClick={() => {
                          if (row.targetWorkspaceId) setActiveWorkspace(row.targetWorkspaceId)
                          setOpen(false)
                          setQuery('')
                        }}
                      >
                        <span className={baseStyles.projectPickLines}>
                          <HighlightedFuzzyText text={row.title} query={query} />
                          <span className={baseStyles.projectPickMeta}>
                            {isActive ? `Current · ${row.subtitle}` : row.subtitle}
                          </span>
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
  )
}
