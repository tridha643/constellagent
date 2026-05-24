import { useEffect, useRef } from 'react'
import type { QuickOpenSearchItem } from '../../../../shared/quick-open-types'
import {
  atMentionFileName,
  atMentionParentDir,
} from '../../../../shared/composer-at-mention'
import type { AppearanceThemeId } from '../../../theme/appearance'
import { SharedFileIcon } from '../../../utils/file-presentation'
import styles from '../Conductor.module.css'

export function ConductorAtMenu({
  items,
  selectedItem,
  loading,
  indexing,
  error,
  appearanceThemeId,
  onSelect,
}: {
  items: readonly QuickOpenSearchItem[]
  selectedItem: QuickOpenSearchItem | undefined
  loading: boolean
  indexing: boolean
  error: string | null
  appearanceThemeId: AppearanceThemeId
  onSelect: (item: QuickOpenSearchItem) => void
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedItem?.path])

  return (
    <div className={styles.conductorAtMenu} data-testid="conductor-at-menu">
      {loading ? (
        <div className={styles.conductorAtMenuStatus}>
          {indexing ? 'Indexing workspace files…' : 'Searching files…'}
        </div>
      ) : error ? (
        <div className={styles.conductorAtMenuStatus}>{error}</div>
      ) : items.length === 0 ? (
        <div className={styles.conductorAtMenuStatus}>No matching files.</div>
      ) : (
        items.map((item) => {
          const active = selectedItem?.path === item.path
          const parentDir = atMentionParentDir(item.relativePath)
          const fileName = atMentionFileName(item.relativePath)
          return (
            <button
              key={item.path}
              ref={active ? activeRef : undefined}
              type="button"
              className={styles.conductorAtMenuItem}
              data-active={active ? 'true' : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(item)}
            >
              <SharedFileIcon
                path={item.relativePath}
                appearanceThemeId={appearanceThemeId}
                className={styles.conductorAtMenuIcon}
              />
              <span className={styles.conductorAtMenuName}>{fileName}</span>
              {parentDir ? (
                <span className={styles.conductorAtMenuDir}>{parentDir}</span>
              ) : null}
            </button>
          )
        })
      )}
    </div>
  )
}
