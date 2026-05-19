import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/app-store'
import { SpotlightToast } from './SpotlightToast'
import type { SpotlightStatus } from '../../../shared/spotlight-types'

interface ActiveToast {
  id: string
  message: string
  action?: { label: string; onClick: () => void }
}

/**
 * Mounts at the app root and renders Spotlight state-transition toasts.
 *
 * Drives toast surface off `spotlightStatusByProject` transitions only — we
 * don't toast on every sync, only on the *meaningful* edges (enter
 * watching-after-preparing, leave to idle, error/blocked). Multiple toasts
 * stack but stay capped at one per project to avoid pile-ups.
 */
export function SpotlightHost() {
  const statuses = useAppStore((s) => s.spotlightStatusByProject)
  const projects = useAppStore((s) => s.projects)
  const workspaces = useAppStore((s) => s.workspaces)
  const [toasts, setToasts] = useState<ActiveToast[]>([])
  const prevStatuses = useRef<Map<string, SpotlightStatus>>(new Map())

  useEffect(() => {
    const next: ActiveToast[] = []
    for (const [projectId, status] of statuses.entries()) {
      const prev = prevStatuses.current.get(projectId)
      const project = projects.find((p) => p.id === projectId)
      const ws = workspaces.find((w) => w.id === status.workspaceId)
      const wsLabel = ws?.name ?? ws?.branch ?? 'workspace'

      // Transition: preparing → watching (first sync complete)
      if (prev?.state === 'preparing' && status.state === 'watching') {
        next.push({
          id: `${projectId}-active`,
          message: `Spotlight active. Root synced from ${wsLabel}.`,
          action: project ? {
            label: 'Open root terminal',
            onClick: () => {
              // We deliberately don't auto-open a PTY here — the toast action
              // is opt-in. Hooking into the store's terminal creator would
              // require a workspace-on-root, which the user may not want.
              void project
            },
          } : undefined,
        })
      }

      // Transition: entered preparing
      if (prev?.state !== 'preparing' && status.state === 'preparing') {
        next.push({
          id: `${projectId}-preparing`,
          message: `Spotlighting ${wsLabel}…`,
        })
      }

      // Transition: into blocked/error — surface the message
      if (
        (status.state === 'blocked' || status.state === 'error') &&
        prev?.state !== status.state
      ) {
        next.push({
          id: `${projectId}-${status.state}`,
          message: status.message ?? (status.state === 'blocked'
            ? 'Spotlight blocked — finish or abort the rebase/merge first.'
            : 'Spotlight error'),
        })
      }
    }

    // Detect releases — projects that had a status but no longer do.
    for (const [projectId, prev] of prevStatuses.current.entries()) {
      if (!statuses.has(projectId) && prev.state !== 'idle') {
        next.push({
          id: `${projectId}-released`,
          message: 'Spotlight released. Root restored.',
        })
      }
    }

    if (next.length > 0) {
      setToasts((cur) => {
        // Dedupe by id — latest wins so rapid toggles don't pile up.
        const map = new Map(cur.map((t) => [t.id, t]))
        for (const t of next) map.set(t.id, t)
        return [...map.values()]
      })
    }

    prevStatuses.current = new Map(statuses)
  }, [statuses, projects, workspaces])

  return (
    <>
      {toasts.map((t, i) => (
        <div key={t.id} style={{ position: 'fixed', right: 0, bottom: 24 + i * 70 }}>
          <SpotlightToast
            message={t.message}
            action={t.action}
            onDismiss={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))}
          />
        </div>
      ))}
    </>
  )
}
