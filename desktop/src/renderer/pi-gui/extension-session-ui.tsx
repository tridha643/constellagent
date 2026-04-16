import { useEffect, useRef, useState } from "react";
import type { HostUiResponse } from "@pi-gui/session-driver";
import { ChevronDownIcon, ChevronRightIcon } from "./icons";
import type {
  SessionExtensionDialogRecord,
  SessionExtensionTuiCustomRecord,
  SessionExtensionUiStateRecord,
} from "@shared/pi/pi-desktop-state";
import { browserKeyEventToTuiData } from "./tui-keyboard-bridge";

const ANSI_ESCAPE_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/g;
const TUI_CURSOR_MARKER = /\u001b_pi:c\u0007/g;
const DOCK_SEGMENT_SEPARATOR = "--------------------";
const GENERIC_ACTIVE_LABEL = "Extension UI active";

interface ExtensionDockBlock {
  readonly key: string;
  readonly lines: readonly string[];
}

export interface ExtensionDockModel {
  readonly summaryText: string;
  readonly bodyText: string;
}

export function hasExtensionDockContent(uiState?: SessionExtensionUiStateRecord): boolean {
  if (!uiState) {
    return false;
  }

  return uiState.statuses.length > 0 || uiState.widgets.length > 0;
}

export function buildExtensionDockModel(uiState?: SessionExtensionUiStateRecord): ExtensionDockModel | undefined {
  if (!hasExtensionDockContent(uiState)) {
    return undefined;
  }

  const statuses = (uiState?.statuses ?? [])
    .map((status) => ({
      key: status.key,
      text: sanitizeDockText(status.text),
    }))
    .filter((status) => status.text.trim().length > 0);
  const primaryBlocks = buildWidgetBlocks(uiState?.widgets ?? [], "aboveComposer");
  const secondaryBlocks = buildWidgetBlocks(uiState?.widgets ?? [], "belowComposer");
  const summaryText = resolveDockSummaryText(statuses, primaryBlocks, secondaryBlocks);

  return {
    summaryText,
    bodyText: buildDockBodyText(statuses, primaryBlocks, secondaryBlocks),
  };
}

export function ExtensionDock({
  dock,
  expanded,
  onToggle,
}: {
  readonly dock: ExtensionDockModel;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <div className={`extension-dock ${expanded ? "extension-dock--expanded" : ""}`} data-testid="extension-dock">
      <button
        aria-controls="extension-dock-body"
        aria-expanded={expanded}
        className="extension-dock__toggle"
        data-testid="extension-dock-toggle"
        title={dock.summaryText}
        type="button"
        onClick={onToggle}
      >
        <span className="extension-dock__summary" data-testid="extension-dock-summary">
          {dock.summaryText}
        </span>
        <span className="extension-dock__chevron" aria-hidden="true">
          {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </span>
      </button>
      {expanded ? (
        <pre className="extension-dock__body" data-testid="extension-dock-body" id="extension-dock-body">
          {dock.bodyText}
        </pre>
      ) : null}
    </div>
  );
}

export function ExtensionDialog({
  dialog,
  onRespond,
}: {
  readonly dialog: SessionExtensionDialogRecord;
  readonly onRespond: (response: HostUiResponse) => void;
}) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (dialog.kind === "input") {
      setDraft(dialog.initialValue ?? "");
      return;
    }
    if (dialog.kind === "editor") {
      setDraft(dialog.initialValue ?? "");
      return;
    }
    setDraft("");
  }, [dialog]);

  return (
    <div className="extension-dialog-backdrop">
      <div
        aria-labelledby="extension-dialog-title"
        aria-modal="true"
        className="extension-dialog"
        data-testid="extension-dialog"
        role="dialog"
      >
        <div className="extension-dialog__title" id="extension-dialog-title">
          {dialog.title}
        </div>
        {dialog.kind === "confirm" ? <p className="extension-dialog__body">{dialog.message}</p> : null}

        {dialog.kind === "select" ? (
          <div className="extension-dialog__options">
            {dialog.options.map((option) => (
              <button
                className="extension-dialog__option"
                key={option}
                type="button"
                onClick={() => onRespond({ requestId: dialog.requestId, value: option })}
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}

        {dialog.kind === "input" ? (
          <input
            autoFocus
            className="skills-search"
            placeholder={dialog.placeholder ?? "Enter a value"}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : null}

        {dialog.kind === "editor" ? (
          <textarea
            autoFocus
            className="extension-dialog__editor"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : null}

        <div className="extension-dialog__actions">
          <button
            className="button button--secondary"
            type="button"
            onClick={() => onRespond({ requestId: dialog.requestId, cancelled: true })}
          >
            Cancel
          </button>
          {dialog.kind === "confirm" ? (
            <button
              className="button button--primary"
              type="button"
              onClick={() => onRespond({ requestId: dialog.requestId, confirmed: true })}
            >
              Confirm
            </button>
          ) : null}
          {dialog.kind === "input" || dialog.kind === "editor" ? (
            <button
              className="button button--primary"
              type="button"
              onClick={() => onRespond({ requestId: dialog.requestId, value: draft })}
            >
              Submit
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ExtensionTuiOverlay({
  model,
  onInputData,
}: {
  readonly model: SessionExtensionTuiCustomRecord;
  readonly onInputData: (data: string) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    surfaceRef.current?.focus();
  }, [model.requestId]);

  const bodyText = model.lines.map((line) => sanitizeDockText(line).replace(TUI_CURSOR_MARKER, "")).join("\n");

  return (
    <div className="extension-tui-backdrop" data-testid="extension-tui-backdrop">
      <div
        ref={surfaceRef}
        aria-modal="true"
        className="extension-tui-panel"
        data-testid="extension-tui-overlay"
        role="application"
        tabIndex={0}
        aria-label={model.title ?? "Interactive extension"}
        onKeyDown={(event) => {
          const data = browserKeyEventToTuiData(event);
          if (data) {
            event.preventDefault();
            event.stopPropagation();
            onInputData(data);
          }
        }}
      >
        {model.title ? <div className="extension-tui-title">{model.title}</div> : null}
        <pre className="extension-tui-body">{bodyText}</pre>
        <p className="extension-tui-hint">Keyboard: arrows, Tab, Enter, Space, Esc — matches terminal pi tools.</p>
      </div>
    </div>
  );
}

function buildWidgetBlocks(
  widgets: SessionExtensionUiStateRecord["widgets"],
  placement: "aboveComposer" | "belowComposer",
): ExtensionDockBlock[] {
  return widgets
    .filter((widget) => widget.placement === placement)
    .map((widget) => ({
      key: widget.key,
      lines: widget.lines.map((line) => sanitizeDockText(line)),
    }))
    .filter((widget) => widget.lines.some((line) => line.trim().length > 0));
}

function resolveDockSummaryText(
  statuses: readonly { readonly key: string; readonly text: string }[],
  primaryBlocks: readonly ExtensionDockBlock[],
  secondaryBlocks: readonly ExtensionDockBlock[],
): string {
  for (const status of statuses) {
    if (status.text.trim().length > 0) {
      return status.text;
    }
  }

  for (const block of [...primaryBlocks, ...secondaryBlocks]) {
    const summaryLine = block.lines.find((line) => line.trim().length > 0);
    if (summaryLine) {
      return summaryLine;
    }
  }

  return GENERIC_ACTIVE_LABEL;
}

function buildDockBodyText(
  statuses: readonly { readonly key: string; readonly text: string }[],
  primaryBlocks: readonly ExtensionDockBlock[],
  secondaryBlocks: readonly ExtensionDockBlock[],
): string {
  const totalBlocks = statuses.length + primaryBlocks.length + secondaryBlocks.length;
  const needsLabels = totalBlocks > 1;
  const primaryLines = [
    ...statuses.flatMap((status, index) => renderStatusBlock(status, needsLabels, index > 0)),
    ...primaryBlocks.flatMap((block, index) => renderWidgetBlock(block, needsLabels, statuses.length + index > 0)),
  ];
  const secondaryLines = secondaryBlocks.flatMap((block, index) =>
    renderWidgetBlock(block, needsLabels, index > 0),
  );

  if (secondaryLines.length === 0) {
    return primaryLines.join("\n");
  }

  if (primaryLines.length === 0) {
    return secondaryLines.join("\n");
  }

  return [...primaryLines, "", DOCK_SEGMENT_SEPARATOR, "", ...secondaryLines].join("\n");
}

function renderStatusBlock(
  status: { readonly key: string; readonly text: string },
  needsLabel: boolean,
  addLeadingGap: boolean,
): string[] {
  const lines = [`${needsLabel ? `${status.key}: ` : ""}${status.text}`];
  return addLeadingGap ? ["", ...lines] : lines;
}

function renderWidgetBlock(block: ExtensionDockBlock, needsLabel: boolean, addLeadingGap: boolean): string[] {
  const lines = needsLabel ? [`${block.key}:`, ...block.lines] : [...block.lines];
  return addLeadingGap ? ["", ...lines] : lines;
}

function sanitizeDockText(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(ANSI_ESCAPE_PATTERN, "");
}
