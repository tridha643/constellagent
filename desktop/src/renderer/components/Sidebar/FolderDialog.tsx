import { useState, useEffect, useCallback, useRef } from "react";
import type { Project } from "../../store/types";
import { useExitAnimation } from "../../hooks/useExitAnimation";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import styles from "./WorkspaceDialog.module.css";

/** Match `WorkspaceDialog` / `shared-dialog-motion.css` exit timing */
const EXIT_MS = 140;

interface Props {
  project: Project;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function FolderDialog({ project, onConfirm, onCancel }: Props) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(true);
  const { shouldRender, animating } = useExitAnimation(open, EXIT_MS);
  const exiting = animating === "exit";
  const dialogRef = useRef<HTMLDivElement>(null);

  // Trap Tab focus inside the dialog so keyboard nav can't reach the obscured app.
  useFocusTrap(dialogRef, shouldRender);

  const animateExit = useCallback(() => {
    if (exiting) return;
    setOpen(false);
  }, [exiting]);

  useEffect(() => {
    if (!shouldRender) {
      onCancel();
    }
  }, [shouldRender, onCancel]);

  const handleSubmit = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  }, [name, onConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (exiting) return;
      if (e.key === "Escape") {
        animateExit();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [exiting, animateExit, handleSubmit],
  );

  const createDisabled = !name.trim();

  if (!shouldRender) {
    return null;
  }

  return (
    <div
      className={`${styles.overlay} constellagent-dialog-overlay ${exiting ? "constellagent-dialog-overlay--exiting" : ""}`}
      onClick={animateExit}
    >
      <div
        ref={dialogRef}
        className={`${styles.dialog} constellagent-dialog-body ${exiting ? "constellagent-dialog-body--exiting" : ""}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.title}>New folder</div>
        <p className={styles.dialogHint}>
          In <strong>{project.name}</strong>
        </p>

        <label className={styles.label} htmlFor="folder-dialog-name">
          Name
        </label>
        <input
          id="folder-dialog-name"
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          placeholder="Folder name"
          autoComplete="off"
        />

        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={animateExit}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.createBtn}
            disabled={createDisabled}
            onClick={handleSubmit}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
