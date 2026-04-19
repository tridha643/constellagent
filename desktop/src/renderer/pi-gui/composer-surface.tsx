import { useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import type { ComposerAttachment, QueuedComposerMessage } from "@shared/pi/pi-desktop-state";
import type {
  ComposerSlashCommand,
  ComposerSlashCommandSection,
  ComposerSlashOption,
  ComposerSlashOptionEmptyState,
} from "./composer-commands";
import { hasFilesInDataTransfer } from "./composer-attachments";
import { reasoningLevelDataAttr } from "./composer-commands";
import { ExtensionDock, type ExtensionDockModel } from "./extension-session-ui";
import { FileIcon, ModelIcon, ReasoningIcon, SettingsIcon, SkillIcon, SparkIcon, StatusIcon } from "./icons";
import { QueuedComposerMessages } from "./queued-composer-messages";

interface ComposerSurfaceProps {
  readonly lastError?: string;
  readonly activeSlashCommand?: ComposerSlashCommand;
  readonly activeSlashCommandMeta?: string;
  readonly topNotice?: ReactNode;
  readonly composerDraft: string;
  readonly setComposerDraft: (draft: string) => void;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly attachments: readonly ComposerAttachment[];
  readonly queuedMessages: readonly QueuedComposerMessage[];
  readonly editingQueuedMessageId?: string;
  readonly slashSections: readonly ComposerSlashCommandSection[];
  readonly slashOptions: readonly ComposerSlashOption[];
  readonly selectedSlashCommand?: ComposerSlashCommand;
  readonly selectedSlashOption?: ComposerSlashOption;
  readonly showSlashMenu: boolean;
  readonly showSlashOptionMenu: boolean;
  readonly slashOptionEmptyState?: ComposerSlashOptionEmptyState;
  readonly onClearSlashCommand: () => void;
  readonly onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Slash / mention menus: caret position within `composerDraft` (UTF-16 offset). */
  readonly onComposerSelectionChange?: (selectionStart: number) => void;
  readonly onComposerPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  readonly onComposerDrop: (event: DragEvent<HTMLDivElement>) => void;
  readonly onRemoveAttachment: (attachmentId: string) => void;
  readonly onEditQueuedMessage: (messageId: string) => void;
  readonly onCancelQueuedEdit: () => void;
  readonly onRemoveQueuedMessage: (messageId: string) => void;
  readonly onSteerQueuedMessage: (messageId: string) => void;
  readonly onSelectSlashCommand: (command: ComposerSlashCommand) => void;
  readonly onSelectSlashOption: (option: ComposerSlashOption) => void;
  readonly showMentionMenu: boolean;
  readonly mentionOptions: readonly string[];
  readonly selectedMentionIndex: number;
  readonly onSelectMention: (filePath: string) => void;
  readonly textareaLabel: string;
  readonly textareaTestId: string;
  readonly textareaPlaceholder: string;
  readonly textareaClassName?: string;
  /** Session thinking level — `low` uses default focus ring; medium+ set `data-reasoning`. */
  readonly thinkingLevel?: string;
  readonly extensionDock?: ExtensionDockModel;
  readonly extensionDockExpanded?: boolean;
  readonly onToggleExtensionDock?: () => void;
  readonly footer: ReactNode;
}

export function ComposerSurface({
  lastError,
  activeSlashCommand,
  activeSlashCommandMeta,
  topNotice,
  composerDraft,
  setComposerDraft,
  composerRef,
  attachments,
  queuedMessages,
  editingQueuedMessageId,
  slashSections,
  slashOptions,
  selectedSlashCommand,
  selectedSlashOption,
  showSlashMenu,
  showSlashOptionMenu,
  slashOptionEmptyState,
  onClearSlashCommand,
  onComposerKeyDown,
  onComposerSelectionChange,
  onComposerPaste,
  onComposerDrop,
  onRemoveAttachment,
  onEditQueuedMessage,
  onCancelQueuedEdit,
  onRemoveQueuedMessage,
  onSteerQueuedMessage,
  onSelectSlashCommand,
  onSelectSlashOption,
  showMentionMenu,
  mentionOptions,
  selectedMentionIndex,
  onSelectMention,
  textareaLabel,
  textareaTestId,
  textareaPlaceholder,
  textareaClassName,
  thinkingLevel,
  extensionDock,
  extensionDockExpanded = false,
  onToggleExtensionDock,
  footer,
}: ComposerSurfaceProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const dragDepthRef = useRef(0);

  const clearDragState = () => {
    dragDepthRef.current = 0;
    setIsDragActive(false);
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!isDragActive) {
      return;
    }
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragActive(false);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!isDragActive) {
      setIsDragActive(true);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    clearDragState();
    onComposerDrop(event);
  };

  const composerTextarea = (
    <textarea
      aria-label={textareaLabel}
      className={textareaClassName}
      data-testid={textareaTestId}
      ref={composerRef}
      value={composerDraft}
      onChange={(event) => {
        setComposerDraft(event.target.value);
        onComposerSelectionChange?.(event.target.selectionStart ?? 0);
      }}
      onSelect={(event) => {
        onComposerSelectionChange?.(event.currentTarget.selectionStart ?? 0);
      }}
      onClick={(event) => {
        onComposerSelectionChange?.(event.currentTarget.selectionStart ?? 0);
      }}
      onKeyUp={(event) => {
        onComposerSelectionChange?.(event.currentTarget.selectionStart ?? 0);
      }}
      onKeyDown={onComposerKeyDown}
      placeholder={textareaPlaceholder}
    />
  );

  const reasoningAttr = reasoningLevelDataAttr(thinkingLevel);

  return (
    <div
      className={`composer__surface ${isDragActive ? "composer__surface--drag-active" : ""}`}
      data-reasoning={reasoningAttr}
      data-testid={`${textareaTestId}-surface`}
      onPaste={onComposerPaste}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {isDragActive ? (
        <div className="composer__drop-indicator" data-testid="composer-drop-indicator">
          Drop images or files to attach
        </div>
      ) : null}
      {activeSlashCommand ? (
        <div className="composer__slash-intent">
          <span className="composer__slash-intent-icon" aria-hidden="true">
            <SlashCommandIcon command={activeSlashCommand} />
          </span>
          <span className="composer__slash-intent-body">
            <span className="composer__slash-intent-title">{activeSlashCommand.title}</span>
            {activeSlashCommandMeta ? (
              <span className="composer__slash-intent-meta">{activeSlashCommandMeta}</span>
            ) : null}
          </span>
          <button
            aria-label={`Clear ${activeSlashCommand.title}`}
            className="composer__slash-intent-clear"
            type="button"
            onClick={onClearSlashCommand}
          >
            ×
          </button>
        </div>
      ) : null}
      <QueuedComposerMessages
        messages={queuedMessages}
        editingQueuedMessageId={editingQueuedMessageId}
        onEditMessage={onEditQueuedMessage}
        onCancelEdit={onCancelQueuedEdit}
        onRemoveMessage={onRemoveQueuedMessage}
        onSteerMessage={onSteerQueuedMessage}
      />
      {attachments.length > 0 ? (
        <div className="composer__attachments">
          {attachments.map((attachment) => (
            <div className={`composer-attachment composer-attachment--${attachment.kind}`} key={attachment.id}>
              {attachment.kind === "image" ? (
                <img
                  alt={attachment.name}
                  className="composer-attachment__preview"
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                />
              ) : (
                <span className="composer-attachment__icon" aria-hidden="true">
                  <FileIcon />
                </span>
              )}
              <span className="composer-attachment__name">{attachment.name}</span>
              <button
                aria-label={`Remove ${attachment.name}`}
                className="composer-attachment__remove"
                type="button"
                onClick={() => onRemoveAttachment(attachment.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {extensionDock && onToggleExtensionDock ? (
        <ExtensionDock dock={extensionDock} expanded={extensionDockExpanded} onToggle={onToggleExtensionDock} />
      ) : null}
      {lastError ? (
        <div className="composer__error error-banner" data-testid="composer-error-banner">
          {lastError}
        </div>
      ) : null}
      <div className="composer__editor">
        {topNotice}
        {showMentionMenu ? (
          <div className="composer__menus">
            <div className="mention-menu" data-testid="mention-menu" onWheel={(event) => event.stopPropagation()}>
              {mentionOptions.map((filePath, index) => {
                const lastSlash = filePath.lastIndexOf("/");
                const dirPart = lastSlash >= 0 ? filePath.slice(0, lastSlash + 1) : "";
                const namePart = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
                return (
                  <button
                    className={`mention-menu__item ${index === selectedMentionIndex ? "mention-menu__item--active" : ""}`}
                    key={filePath}
                    type="button"
                    onClick={() => onSelectMention(filePath)}
                  >
                    {dirPart ? <span className="mention-menu__dirname">{dirPart}</span> : null}
                    <span className="mention-menu__filename">{namePart}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {showSlashMenu || (showSlashOptionMenu && selectedSlashCommand) ? (
          <div className="composer__menus">
            {showSlashMenu ? (
              <div className="slash-menu" data-testid="slash-menu" onWheel={(event) => event.stopPropagation()}>
                {slashSections.map((section) => (
                  <div className="slash-menu__section" key={section.id}>
                    {section.title ? (
                      <div className={`slash-menu__section-title slash-menu__section-title--${section.id}`}>
                        <span className="slash-menu__section-icon" aria-hidden="true">
                          {section.id === "runtime" ? <SparkIcon /> : <SettingsIcon />}
                        </span>
                        <span>{section.title}</span>
                      </div>
                    ) : null}
                    {section.items.map((command) => (
                      <button
                        className={`slash-menu__item ${command.section === "runtime" ? "slash-menu__item--skill" : ""} ${selectedSlashCommand?.id === command.id ? "slash-menu__item--active" : ""}`}
                        key={command.id}
                        type="button"
                        onClick={() => onSelectSlashCommand(command)}
                      >
                        <span className="slash-menu__icon" aria-hidden="true">
                          <SlashCommandIcon command={command} />
                        </span>
                        {command.section === "runtime" ? (
                          <span className="slash-menu__content slash-menu__content--skill">
                            <span className="slash-menu__line">
                              <span className="slash-menu__title">{command.title}</span>
                              {command.sourceLabel ? <span className="slash-menu__skill-badge">{command.sourceLabel}</span> : null}
                              {command.compatibility?.status === "terminal-only" ? (
                                <span className="slash-menu__skill-badge slash-menu__skill-badge--warning">Terminal-only</span>
                              ) : null}
                            </span>
                            <span className="slash-menu__description">{command.description}</span>
                            <span className="slash-menu__meta">
                              <span className="slash-menu__command slash-menu__command--skill">{command.command}</span>
                            </span>
                          </span>
                        ) : (
                          <span className="slash-menu__content">
                            <span className="slash-menu__line">
                              <span className="slash-menu__title">{command.title}</span>
                              <span className="slash-menu__command">{command.command}</span>
                            </span>
                            <span className="slash-menu__description">{command.description}</span>
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
            {showSlashOptionMenu && selectedSlashCommand ? (
              <div className="slash-menu slash-menu--options" data-testid="slash-options-menu" onWheel={(event) => event.stopPropagation()}>
                <div className="slash-menu__search">{selectedSlashCommand.title}</div>
                {slashOptions.length > 0
                  ? slashOptions.map((option) => (
                      <button
                        className={`slash-menu__option ${selectedSlashOption?.value === option.value ? "slash-menu__option--active" : ""}`}
                        key={option.value}
                        type="button"
                        onClick={() => onSelectSlashOption(option)}
                      >
                        <span className="slash-menu__option-title">{option.label}</span>
                        <span className="slash-menu__option-description">{option.description}</span>
                      </button>
                    ))
                  : slashOptionEmptyState ? (
                      <div className="slash-menu__empty">
                        <div className="slash-menu__empty-title">{slashOptionEmptyState.title}</div>
                        <div className="slash-menu__empty-description">{slashOptionEmptyState.description}</div>
                      </div>
                    ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {composerTextarea}
        <div className="composer__bar">{footer}</div>
      </div>
    </div>
  );
}

function SlashCommandIcon({ command }: { readonly command: ComposerSlashCommand }) {
  switch (command.kind) {
    case "runtime":
      return command.runtimeCommand?.source === "skill" ? <SkillIcon /> : <SparkIcon />;
    case "model":
      return <ModelIcon />;
    case "thinking":
      return <ReasoningIcon />;
    case "status":
      return <StatusIcon />;
    default:
      return <SparkIcon />;
  }
}
