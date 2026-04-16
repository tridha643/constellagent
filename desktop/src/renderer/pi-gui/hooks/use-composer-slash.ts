import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import type { RuntimeCommandRecord } from "@pi-gui/session-driver/runtime-types";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ExtensionCommandCompatibilityRecord } from "@shared/pi/pi-desktop-state";
import {
  buildSlashCommandSections,
  flattenSlashSections,
  parseActiveSlashToken,
  slashOptionEmptyState as getSlashOptionEmptyState,
  slashOptionsForCommand,
  type ComposerModelOption,
  type ComposerSlashCommand,
  type ComposerSlashCommandSection,
  type ComposerSlashOption,
} from "../composer-commands";

export interface ComposerReasoningHotkey {
  readonly disabled: boolean;
  readonly onCycle: () => void;
}

export interface UseComposerSlashArgs {
  readonly draft: string;
  /** Must persist to Pi host when the draft changes (e.g. wrap `setDraft` + `updateComposerDraft`). */
  readonly setDraft: Dispatch<SetStateAction<string>>;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly runtime: RuntimeSnapshot | undefined;
  readonly sessionCommands: readonly RuntimeCommandRecord[];
  readonly compatibilityRecords: readonly ExtensionCommandCompatibilityRecord[];
  /** e.g. open Constellagent settings for `/settings` */
  readonly onHostImmediate?: (command: ComposerSlashCommand) => void;
  /** Shift+Tab cycles session reasoning when slash menus are closed (see `wrapComposerKeyDown`). */
  readonly reasoningHotkey?: ComposerReasoningHotkey;
}

export function useComposerSlash({
  draft,
  setDraft,
  composerRef,
  runtime,
  sessionCommands,
  compatibilityRecords,
  onHostImmediate,
  reasoningHotkey,
}: UseComposerSlashArgs) {
  const [cursor, setCursor] = useState(0);
  const [mainMenuIndex, setMainMenuIndex] = useState(0);
  const [pickCommand, setPickCommand] = useState<ComposerSlashCommand | null>(null);
  const [optionIndex, setOptionIndex] = useState(0);

  const slashToken = useMemo(() => parseActiveSlashToken(draft, cursor), [draft, cursor]);

  const slashSections: readonly ComposerSlashCommandSection[] = useMemo(() => {
    if (!slashToken) {
      return [];
    }
    return buildSlashCommandSections(slashToken.query, runtime, sessionCommands, compatibilityRecords, {
      allowTreeCommand: true,
    });
  }, [slashToken, runtime, sessionCommands, compatibilityRecords]);

  const flatCommands = useMemo(() => flattenSlashSections(slashSections), [slashSections]);

  const showSlashOptionMenu = pickCommand !== null;
  const showSlashMenu = Boolean(slashToken) && !showSlashOptionMenu && flatCommands.length > 0;

  const slashOptions: readonly ComposerSlashOption[] = useMemo(() => {
    if (!showSlashOptionMenu || !pickCommand) {
      return [];
    }
    return slashOptionsForCommand(pickCommand, runtime);
  }, [showSlashOptionMenu, pickCommand, runtime]);

  const slashOptionEmpty = useMemo(() => {
    if (!showSlashOptionMenu || !pickCommand) {
      return undefined;
    }
    return getSlashOptionEmptyState(pickCommand, runtime);
  }, [showSlashOptionMenu, pickCommand, runtime]);

  const selectedSlashCommand: ComposerSlashCommand | undefined = showSlashOptionMenu
    ? pickCommand ?? undefined
    : showSlashMenu
      ? flatCommands[Math.min(mainMenuIndex, flatCommands.length - 1)]
      : undefined;

  const selectedSlashOption: ComposerSlashOption | undefined =
    showSlashOptionMenu && slashOptions.length > 0
      ? slashOptions[Math.min(optionIndex, slashOptions.length - 1)]
      : undefined;

  useEffect(() => {
    setMainMenuIndex(0);
  }, [slashToken?.from, slashToken?.query]);

  useEffect(() => {
    setMainMenuIndex((i) => {
      if (flatCommands.length === 0) {
        return 0;
      }
      return Math.min(i, flatCommands.length - 1);
    });
  }, [flatCommands.length]);

  useEffect(() => {
    setOptionIndex(0);
  }, [pickCommand?.id]);

  useEffect(() => {
    setOptionIndex((i) => {
      if (slashOptions.length === 0) {
        return 0;
      }
      return Math.min(i, slashOptions.length - 1);
    });
  }, [slashOptions.length]);

  useEffect(() => {
    if (!slashToken) {
      setPickCommand(null);
    }
  }, [slashToken]);

  const closeSlashUi = useCallback(() => {
    setPickCommand(null);
  }, []);

  const replaceRange = useCallback(
    (from: number, to: number, insert: string) => {
      setDraft((prev) => {
        const next = prev.slice(0, from) + insert + prev.slice(to);
        const pos = from + insert.length;
        requestAnimationFrame(() => {
          const el = composerRef.current;
          if (el) {
            el.focus();
            el.selectionStart = el.selectionEnd = pos;
            setCursor(pos);
          }
        });
        return next;
      });
    },
    [setDraft, composerRef],
  );

  const dismissSlashMenu = useCallback(() => {
    if (!slashToken) {
      return;
    }
    replaceRange(slashToken.from, slashToken.to, "");
    closeSlashUi();
  }, [slashToken, replaceRange, closeSlashUi]);

  const applySlashCommand = useCallback(
    (command: ComposerSlashCommand) => {
      if (!slashToken) {
        return;
      }
      if (command.submitMode === "pick-option") {
        setPickCommand(command);
        setOptionIndex(0);
        return;
      }
      if (command.submitMode === "prefill") {
        replaceRange(slashToken.from, slashToken.to, command.template);
        closeSlashUi();
        return;
      }
      if (command.submitMode === "immediate") {
        if (command.kind === "settings" && onHostImmediate) {
          onHostImmediate(command);
          replaceRange(slashToken.from, slashToken.to, "");
          closeSlashUi();
          return;
        }
        const tail = command.template.endsWith(" ") ? command.template : `${command.template} `;
        replaceRange(slashToken.from, slashToken.to, tail);
        closeSlashUi();
        return;
      }
      const tail = command.template.endsWith(" ") ? command.template : `${command.template} `;
      replaceRange(slashToken.from, slashToken.to, tail);
      closeSlashUi();
    },
    [slashToken, replaceRange, closeSlashUi, onHostImmediate],
  );

  const applySlashOption = useCallback(
    (option: ComposerSlashOption) => {
      if (!slashToken || !pickCommand) {
        return;
      }
      let insert = "";
      if (pickCommand.kind === "model") {
        const m = option as ComposerModelOption;
        insert = `/model ${m.providerId} ${m.modelId}`;
      } else if (pickCommand.kind === "thinking") {
        insert = `/thinking ${option.value}`;
      } else if (pickCommand.kind === "login") {
        insert = `/login ${option.value}`;
      } else if (pickCommand.kind === "logout") {
        insert = `/logout ${option.value}`;
      } else {
        insert = `${pickCommand.command} ${option.value}`;
      }
      replaceRange(slashToken.from, slashToken.to, `${insert} `);
      closeSlashUi();
    },
    [slashToken, pickCommand, replaceRange, closeSlashUi],
  );

  const onSelectSlashCommand = useCallback(
    (command: ComposerSlashCommand) => {
      applySlashCommand(command);
    },
    [applySlashCommand],
  );

  const onSelectSlashOption = useCallback(
    (option: ComposerSlashOption) => {
      applySlashOption(option);
    },
    [applySlashOption],
  );

  const onClearSlashCommand = useCallback(() => {
    setPickCommand(null);
  }, []);

  const onComposerSelectionChange = useCallback((pos: number) => {
    setCursor(pos);
  }, []);

  const wrapComposerKeyDown = useCallback(
    (base: (event: KeyboardEvent<HTMLTextAreaElement>) => void) => {
      return (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (showSlashOptionMenu && pickCommand) {
          if (slashOptions.length > 0) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOptionIndex((i) => (i + 1) % slashOptions.length);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setOptionIndex((i) => (i - 1 + slashOptions.length) % slashOptions.length);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              const opt = slashOptions[optionIndex];
              if (opt) {
                applySlashOption(opt);
              }
              return;
            }
            if (event.key === "Tab" && event.shiftKey) {
              event.preventDefault();
              setOptionIndex((i) => (i - 1 + slashOptions.length) % slashOptions.length);
              return;
            }
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setPickCommand(null);
            return;
          }
        }

        if (showSlashMenu && flatCommands.length > 0) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setMainMenuIndex((i) => (i + 1) % flatCommands.length);
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setMainMenuIndex((i) => (i - 1 + flatCommands.length) % flatCommands.length);
            return;
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            const cmd = flatCommands[mainMenuIndex];
            if (cmd) {
              applySlashCommand(cmd);
            }
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            dismissSlashMenu();
            return;
          }
          if (event.key === "Tab" && event.shiftKey) {
            event.preventDefault();
            setMainMenuIndex((i) => (i - 1 + flatCommands.length) % flatCommands.length);
            return;
          }
          if (event.key === "Tab" && !event.shiftKey) {
            event.preventDefault();
            setMainMenuIndex((i) => (i + 1) % flatCommands.length);
            return;
          }
        }

        if (
          reasoningHotkey &&
          !reasoningHotkey.disabled &&
          event.key === "Tab" &&
          event.shiftKey &&
          !showSlashMenu &&
          !showSlashOptionMenu
        ) {
          event.preventDefault();
          reasoningHotkey.onCycle();
          return;
        }

        base(event);
      };
    },
    [
      showSlashOptionMenu,
      pickCommand,
      slashOptions,
      optionIndex,
      applySlashOption,
      showSlashMenu,
      flatCommands,
      mainMenuIndex,
      applySlashCommand,
      dismissSlashMenu,
      reasoningHotkey,
    ],
  );

  return {
    slashSections,
    slashOptions,
    showSlashMenu,
    showSlashOptionMenu,
    selectedSlashCommand,
    selectedSlashOption,
    slashOptionEmptyState: slashOptionEmpty,
    onSelectSlashCommand,
    onSelectSlashOption,
    onClearSlashCommand,
    onComposerSelectionChange,
    wrapComposerKeyDown,
    activeSlashCommand: pickCommand ?? undefined,
    activeSlashCommandMeta: undefined as string | undefined,
  };
}
