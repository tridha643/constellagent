import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import {
  buildModelOptions,
  MODEL_OPTIONS_EMPTY_DESCRIPTION,
  MODEL_OPTIONS_EMPTY_TITLE,
  THINKING_OPTIONS,
  type ComposerModelOption,
} from "./composer-commands";

interface ModelSelectorProps {
  readonly runtime: RuntimeSnapshot | undefined;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly disabled?: boolean;
  readonly dropdownPlacement?: "above" | "below";
  readonly showEmptyModelControl?: boolean;
  readonly unselectedModelLabel?: string;
  readonly emptyModelLabel?: string;
  readonly emptyModelTitle?: string;
  readonly emptyModelDescription?: string;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
}

type OpenDropdown = "none" | "model" | "thinking";

function optionMatchesQuery(haystack: string, query: string): boolean {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const h = haystack.toLowerCase();
  return tokens.every((t) => h.includes(t));
}

export function ModelSelector({
  runtime,
  provider,
  modelId,
  thinkingLevel,
  disabled,
  dropdownPlacement = "above",
  showEmptyModelControl = false,
  unselectedModelLabel = "Choose model",
  emptyModelLabel = "Choose model",
  emptyModelTitle = MODEL_OPTIONS_EMPTY_TITLE,
  emptyModelDescription = MODEL_OPTIONS_EMPTY_DESCRIPTION,
  onSetModel,
  onSetThinking,
}: ModelSelectorProps) {
  const [open, setOpen] = useState<OpenDropdown>("none");
  const [modelQuery, setModelQuery] = useState("");
  const [modelHighlight, setModelHighlight] = useState(0);
  const [thinkingHighlight, setThinkingHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const modelSearchRef = useRef<HTMLInputElement | null>(null);
  const thinkingMenuRef = useRef<HTMLDivElement | null>(null);

  const groupedModels = useMemo(() => groupByProvider(buildModelOptions(runtime)), [runtime]);
  const hasModelControl = Boolean(provider && modelId) || groupedModels.length > 0;
  const shouldRenderModelControl = hasModelControl || showEmptyModelControl;
  const modelBadgeLabel =
    provider && modelId ? `${provider}:${modelId}` : groupedModels.length > 0 ? unselectedModelLabel : emptyModelLabel;

  const filteredModelGroups = useMemo(() => {
    if (!modelQuery.trim()) return groupedModels;
    return groupedModels
      .map((g) => ({
        provider: g.provider,
        items: g.items.filter((opt) =>
          optionMatchesQuery(`${opt.providerId} ${opt.modelId} ${opt.label}`, modelQuery),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [groupedModels, modelQuery]);

  const flatModelOptions = useMemo(() => {
    const out: ComposerModelOption[] = [];
    for (const g of filteredModelGroups) {
      for (const item of g.items) out.push(item);
    }
    return out;
  }, [filteredModelGroups]);

  useLayoutEffect(() => {
    if (open === "model") {
      setModelQuery("");
      setModelHighlight(0);
      queueMicrotask(() => modelSearchRef.current?.focus());
    } else if (open === "thinking") {
      const idx = THINKING_OPTIONS.findIndex((o) => o.value === thinkingLevel);
      setThinkingHighlight(idx >= 0 ? idx : 0);
      queueMicrotask(() => thinkingMenuRef.current?.focus());
    }
  }, [open, thinkingLevel]);

  useEffect(() => {
    if (open !== "model") return;
    setModelHighlight(0);
  }, [open, modelQuery]);

  useEffect(() => {
    if (open !== "model") return;
    setModelHighlight((h) => Math.min(h, Math.max(0, flatModelOptions.length - 1)));
  }, [open, flatModelOptions.length]);

  useEffect(() => {
    if (open !== "thinking") return;
    setThinkingHighlight((h) => Math.min(h, Math.max(0, THINKING_OPTIONS.length - 1)));
  }, [open]);

  useEffect(() => {
    if (open === "none") return undefined;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen("none");
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen("none");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const pickModelAtIndex = useCallback(
    (index: number) => {
      const opt = flatModelOptions[index];
      if (!opt) return;
      const isActive = opt.providerId === provider && opt.modelId === modelId;
      if (!isActive) {
        onSetModel(opt.providerId, opt.modelId);
      }
      setOpen("none");
    },
    [flatModelOptions, provider, modelId, onSetModel],
  );

  const pickThinkingAtIndex = useCallback(
    (index: number) => {
      const opt = THINKING_OPTIONS[index];
      if (!opt) return;
      if (opt.value !== thinkingLevel) {
        onSetThinking(opt.value);
      }
      setOpen("none");
    },
    [thinkingLevel, onSetThinking],
  );

  const onModelSearchKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (flatModelOptions.length === 0) {
        if (e.key === "Enter") e.preventDefault();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setModelHighlight((h) => Math.min(flatModelOptions.length - 1, h + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setModelHighlight((h) => Math.max(0, h - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        pickModelAtIndex(modelHighlight);
      }
    },
    [flatModelOptions.length, modelHighlight, pickModelAtIndex],
  );

  const onThinkingMenuKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const len = THINKING_OPTIONS.length;
      if (len === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setThinkingHighlight((h) => Math.min(len - 1, h + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setThinkingHighlight((h) => Math.max(0, h - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        pickThinkingAtIndex(thinkingHighlight);
      }
    },
    [thinkingHighlight, pickThinkingAtIndex],
  );

  if (!shouldRenderModelControl && !thinkingLevel) {
    return null;
  }

  const dropdownClass = `model-selector__dropdown ${dropdownPlacement === "below" ? "model-selector__dropdown--below" : ""}`;

  return (
    <span className="model-selector" ref={containerRef}>
      {shouldRenderModelControl ? (
        <span className="model-selector__anchor">
          <button
            className="model-selector__badge"
            type="button"
            disabled={disabled}
            onClick={() => setOpen(open === "model" ? "none" : "model")}
          >
            {modelBadgeLabel}
          </button>
          {open === "model" ? (
            <div className={dropdownClass} onWheel={(event) => event.stopPropagation()}>
              <input
                ref={modelSearchRef}
                className="model-selector__search"
                type="search"
                value={modelQuery}
                onChange={(ev) => setModelQuery(ev.target.value)}
                onKeyDown={onModelSearchKeyDown}
                placeholder="Search models…"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              {flatModelOptions.length === 0 && groupedModels.length > 0 ? (
                <div className="model-selector__empty">No matching models</div>
              ) : null}
              {(() => {
                let row = 0;
                return filteredModelGroups.map((group) => (
                  <div key={group.provider}>
                    <div className="model-selector__group-title">{group.provider}</div>
                    {group.items.map((option) => {
                      const myRow = row++;
                      const isActive = option.providerId === provider && option.modelId === modelId;
                      const isHl = myRow === modelHighlight;
                      return (
                        <button
                          className={`model-selector__item${isActive ? " model-selector__item--active" : ""}${
                            isHl ? " model-selector__item--keyboard" : ""
                          }`}
                          key={`${option.providerId}:${option.modelId}`}
                          type="button"
                          onMouseEnter={() => setModelHighlight(myRow)}
                          onClick={() => {
                            pickModelAtIndex(myRow);
                          }}
                        >
                          <span className="model-selector__item-label">{option.label}</span>
                          {isActive ? <span className="model-selector__item-meta">active</span> : null}
                        </button>
                      );
                    })}
                  </div>
                ));
              })()}
              {groupedModels.length === 0 ? (
                <>
                  <div className="model-selector__group-title">{emptyModelTitle}</div>
                  <div className="model-selector__empty">{emptyModelDescription}</div>
                </>
              ) : null}
            </div>
          ) : null}
        </span>
      ) : null}
      {thinkingLevel ? (
        <span className="model-selector__anchor">
          <button
            className="model-selector__badge"
            data-testid="pi-thinking-badge"
            type="button"
            disabled={disabled}
            onClick={() => setOpen(open === "thinking" ? "none" : "thinking")}
          >
            {thinkingLevel}
          </button>
          {open === "thinking" ? (
            <div
              ref={thinkingMenuRef}
              className={dropdownClass}
              role="menu"
              tabIndex={-1}
              onWheel={(event) => event.stopPropagation()}
              onKeyDown={onThinkingMenuKeyDown}
            >
              <div className="model-selector__group-title">Thinking Level</div>
              {THINKING_OPTIONS.map((option, myRow) => {
                const isActive = option.value === thinkingLevel;
                const isHl = myRow === thinkingHighlight;
                return (
                  <button
                    className={`model-selector__item${isActive ? " model-selector__item--active" : ""}${
                      isHl ? " model-selector__item--keyboard" : ""
                    }`}
                    key={option.value}
                    type="button"
                    onMouseEnter={() => setThinkingHighlight(myRow)}
                    onClick={() => {
                      pickThinkingAtIndex(myRow);
                    }}
                  >
                    <span className="model-selector__item-label">{option.label}</span>
                    <span className="model-selector__item-meta">{option.description}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

interface ModelGroup {
  readonly provider: string;
  readonly items: readonly ComposerModelOption[];
}

function groupByProvider(options: readonly ComposerModelOption[]): readonly ModelGroup[] {
  const groups = new Map<string, ComposerModelOption[]>();
  for (const option of options) {
    const existing = groups.get(option.providerId);
    if (existing) {
      existing.push(option);
    } else {
      groups.set(option.providerId, [option]);
    }
  }
  return Array.from(groups.entries()).map(([provider, items]) => ({ provider, items }));
}
