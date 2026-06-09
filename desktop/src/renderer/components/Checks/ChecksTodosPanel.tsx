import { useAppStore } from '../../store/app-store'
import { usePrChecks } from '../../hooks/usePrChecks'
import { ChecksPanel } from './ChecksPanel'
import { TodosPanel } from './TodosPanel'
import styles from './Checks.module.css'

/**
 * Sidebar panel body for the per-workspace "Checks & Todos" view. Mounted only while it
 * is the active side panel (so the PR poll runs only when visible). Derives the PR live
 * from the workspace branch and stacks the Checks section above the Todos section.
 */
export function ChecksTodosPanel({ workspaceId }: { workspaceId: string }) {
  const workspace = useAppStore((s) => s.workspaces.find((w) => w.id === workspaceId))

  const checks = usePrChecks({
    projectId: workspace?.projectId,
    worktreePath: workspace?.worktreePath,
    branch: workspace?.branch ?? '',
    active: true,
  })

  return (
    <div className={styles.panel} data-testid="checks-todos-panel">
      <div className={styles.scroll}>
        <ChecksPanel checks={checks} />
        <TodosPanel workspaceId={workspaceId} />
      </div>
    </div>
  )
}
