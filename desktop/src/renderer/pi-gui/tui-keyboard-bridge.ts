import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * Maps browser key events to byte sequences understood by `@mariozechner/pi-tui` / `matchesKey`
 * (legacy CSI sequences, no Kitty protocol).
 */
export function browserKeyEventToTuiData(event: ReactKeyboardEvent<Element>): string | null {
  if (event.repeat) {
    return null;
  }
  if (event.metaKey && !event.ctrlKey) {
    return null;
  }

  if (event.key === "Escape") {
    return "\x1b";
  }
  if (event.key === "Enter") {
    return "\r";
  }
  if (event.key === "Tab") {
    return event.shiftKey ? "\x1b[Z" : "\t";
  }
  if (event.key === "ArrowUp") {
    return "\x1b[A";
  }
  if (event.key === "ArrowDown") {
    return "\x1b[B";
  }
  if (event.key === "ArrowRight") {
    return "\x1b[C";
  }
  if (event.key === "ArrowLeft") {
    return "\x1b[D";
  }
  if (event.key === "Backspace") {
    return "\x7f";
  }
  if (event.key === "Delete") {
    return "\x1b[3~";
  }
  if (event.key === "Home") {
    return "\x1b[H";
  }
  if (event.key === "End") {
    return "\x1b[F";
  }

  if (event.key === " " && event.code === "Space") {
    return " ";
  }

  if (event.ctrlKey && event.key.length === 1) {
    const code = event.key.toLowerCase().charCodeAt(0);
    if (code >= 97 && code <= 122) {
      return String.fromCharCode(code - 96);
    }
  }

  if (event.key.length === 1 && !event.ctrlKey && !event.altKey) {
    return event.key;
  }

  return null;
}
