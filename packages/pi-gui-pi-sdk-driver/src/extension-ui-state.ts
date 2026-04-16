import type { HostUiRequest } from "@pi-gui/session-driver";

export interface ExtensionUiWidgetState {
  readonly key: string;
  readonly lines: readonly string[];
  readonly placement: "aboveComposer" | "belowComposer";
}

export interface ExtensionUiTuiCustomState {
  requestId: string;
  lines: string[];
  columns: number;
  title?: string;
}

export interface ExtensionUiState {
  readonly statuses: Map<string, string>;
  readonly widgets: Map<string, ExtensionUiWidgetState>;
  title: string | undefined;
  editorText: string | undefined;
  tuiCustom: ExtensionUiTuiCustomState | undefined;
}

export type ExtensionUiDialogRequest = Extract<
  HostUiRequest,
  { readonly kind: "confirm" | "select" | "input" | "editor" }
>;

export function createEmptyExtensionUiState(): ExtensionUiState {
  return {
    statuses: new Map(),
    widgets: new Map(),
    title: undefined,
    editorText: undefined,
    tuiCustom: undefined,
  };
}

export function applyHostUiRequestToExtensionUiState(
  state: ExtensionUiState,
  request: HostUiRequest,
): void {
  switch (request.kind) {
    case "status":
      if (request.text) {
        state.statuses.set(request.key, request.text);
      } else {
        state.statuses.delete(request.key);
      }
      break;
    case "widget":
      if (request.lines && request.lines.length > 0) {
        state.widgets.set(request.key, {
          key: request.key,
          lines: [...request.lines],
          placement: request.placement ?? "aboveComposer",
        });
      } else {
        state.widgets.delete(request.key);
      }
      break;
    case "title":
      state.title = request.title;
      break;
    case "editorText":
      state.editorText = request.text;
      break;
    case "tuiCustom":
      if (request.phase === "close") {
        state.tuiCustom = undefined;
        break;
      }
      if (request.phase === "open") {
        state.tuiCustom = {
          requestId: request.requestId,
          lines: [],
          columns: request.columns ?? 80,
          ...(request.title ? { title: request.title } : {}),
        };
        break;
      }
      if (request.phase === "frame") {
        const current = state.tuiCustom;
        if (!current || current.requestId !== request.requestId) {
          break;
        }
        current.lines = request.lines ? [...request.lines] : [];
        if (request.columns !== undefined) {
          current.columns = request.columns;
        }
        break;
      }
      break;
    default:
      break;
  }
}

export function isExtensionUiDialogRequest(request: HostUiRequest): request is ExtensionUiDialogRequest {
  return request.kind === "confirm" || request.kind === "select" || request.kind === "input" || request.kind === "editor";
}
