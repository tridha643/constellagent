import { useCallback } from 'react'
import { Allotment } from 'allotment'
import { useAppStore } from '../../store/app-store'
import { ChatView } from './ChatView'
import { TerminalPanel } from './TerminalPanel'
import { FileEditorPane } from './FileEditorPane'
import type { SplitNode, Tab } from '../../store/types'
import styles from './TerminalSplitContainer.module.css'

type TerminalTab = Extract<Tab, { type: 'terminal' }>
type FileTab = Extract<Tab, { type: 'file' }>

interface ContainerProps {
  tab: TerminalTab
  active: boolean
  worktreePath?: string
  workspaceName?: string
  branch?: string
}

export function TerminalSplitContainer({ tab, active, worktreePath, workspaceName, branch }: ContainerProps) {
  const setFocusedPane = useAppStore((s) => s.setFocusedPane)

  const handlePaneFocus = useCallback(
    (paneId: string) => {
      setFocusedPane(tab.id, paneId)
    },
    [tab.id, setFocusedPane],
  )

  // No splits — render a single TerminalPanel in a centered chat shell.
  if (!tab.splitRoot) {
    return (
      <ChatView
        active={active}
        title={tab.title}
        agentType={tab.agentType}
        workspaceName={workspaceName}
        branch={branch}
        worktreePath={worktreePath}
      >
        <TerminalPanel
          key={tab.ptyId}
          ptyId={tab.ptyId}
          active={active}
        />
      </ChatView>
    )
  }

  // Split panes keep their power-user layout, but now live inside the same chat shell.
  return (
    <ChatView
      active={active}
      title={tab.title}
      agentType={tab.agentType}
      workspaceName={workspaceName}
      branch={branch}
      worktreePath={worktreePath}
      splitMode
    >
      <div className={`${styles.splitWrapper} ${active ? styles.active : styles.hidden}`}>
        <SplitTreeNode
          node={tab.splitRoot}
          focusedPaneId={tab.focusedPaneId}
          onPaneFocus={handlePaneFocus}
          worktreePath={worktreePath}
        />
      </div>
    </ChatView>
  )
}

/** File tab with editor-only split (tab bar merge of file ↔ file or file → terminal lives on the terminal tab). */
export function FileTabSplitContainer({ tab, active, worktreePath }: { tab: FileTab; active: boolean; worktreePath?: string }) {
  const setFocusedPane = useAppStore((s) => s.setFocusedPane)

  const handlePaneFocus = useCallback(
    (paneId: string) => {
      setFocusedPane(tab.id, paneId)
    },
    [tab.id, setFocusedPane],
  )

  if (!tab.splitRoot) return null

  return (
    <div className={`${styles.splitWrapper} ${active ? styles.active : styles.hidden}`}>
      <SplitTreeNode
        node={tab.splitRoot}
        focusedPaneId={tab.focusedPaneId}
        onPaneFocus={handlePaneFocus}
        worktreePath={worktreePath}
      />
    </div>
  )
}

interface SplitTreeProps {
  node: SplitNode
  focusedPaneId: string | undefined
  onPaneFocus: (paneId: string) => void
  worktreePath?: string
}

function SplitTreeNode({ node, focusedPaneId, onPaneFocus, worktreePath }: SplitTreeProps) {
  if (node.type === 'leaf') {
    // Render file editor pane for file leaves
    if (node.contentType === 'file') {
      return (
        <FileEditorPane
          filePath={node.filePath}
          paneId={node.id}
          onFocus={onPaneFocus}
          isFocusedPane={node.id === focusedPaneId}
          worktreePath={worktreePath}
        />
      )
    }

    // Render terminal pane for terminal leaves
    return (
      <TerminalPanel
        ptyId={node.ptyId}
        active={true}
        inSplit={true}
        paneId={node.id}
        onFocus={onPaneFocus}
        isFocusedPane={node.id === focusedPaneId}
      />
    )
  }

  // 'horizontal' = side by side, 'vertical' = stacked
  const isVertical = node.direction === 'vertical'

  return (
    <Allotment vertical={isVertical}>
      {node.children.map((child) => (
        <Allotment.Pane key={child.id} minSize={100}>
          <SplitTreeNode
            node={child}
            focusedPaneId={focusedPaneId}
            onPaneFocus={onPaneFocus}
            worktreePath={worktreePath}
          />
        </Allotment.Pane>
      ))}
    </Allotment>
  )
}
