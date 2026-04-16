import { useMemo, useState, type KeyboardEvent } from "react";
import { ChevronRightIcon } from "./icons";

interface DiffLine {
  readonly type: "added" | "removed" | "context" | "header";
  readonly content: string;
  readonly lineNumber?: number;
}

export interface FileDiffSection {
  readonly path: string;
  readonly lines: DiffLine[];
  readonly added: number;
  readonly removed: number;
}

export function countDiffFiles(diff: string): number {
  if (!diff.trim()) return 0;
  if (/^diff --git /m.test(diff)) {
    const n = diff.match(/^diff --git /gm)?.length ?? 0;
    return Math.max(1, n);
  }
  return 1;
}

/** Split a unified / git diff into one chunk per file when `diff --git` is present. */
function splitIntoFileChunks(diff: string): string[] {
  const normalized = diff.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ") && current.length > 0) {
      chunks.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) {
    chunks.push(current.join("\n"));
  }

  if (chunks.length > 0) {
    return chunks;
  }
  return [normalized];
}

function extractPathFromChunk(chunk: string): string {
  const git = /^diff --git a\/(.+?) b\/(.+)$/m.exec(chunk);
  if (git?.[2]) {
    return git[2];
  }
  const plusB = /^\+\+\+ b\/(.+)$/m.exec(chunk);
  if (plusB?.[1]) {
    return plusB[1].trim();
  }
  const plus = /^\+\+\+ (.+)$/m.exec(chunk);
  if (plus?.[1]) {
    return plus[1].replace(/^(a|b)\//, "").trim();
  }
  return "Changes";
}

function parseDiffLines(lines: readonly string[]): DiffLine[] {
  const result: DiffLine[] = [];
  let lineNumber = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
      lineNumber = match ? parseInt(match[1] ?? "0", 10) : 0;
      result.push({ type: "header", content: line });
      continue;
    }
    if (line.startsWith("---") || line.startsWith("+++")) {
      continue;
    }
    if (line.startsWith("+")) {
      result.push({ type: "added", content: line.slice(1), lineNumber });
      lineNumber += 1;
    } else if (line.startsWith("-")) {
      result.push({ type: "removed", content: line.slice(1) });
    } else if (line.startsWith(" ") || line === "") {
      result.push({ type: "context", content: line.slice(1), lineNumber });
      lineNumber += 1;
    }
  }

  return result;
}

function parseChunkToLines(chunk: string): DiffLine[] {
  return parseDiffLines(chunk.split("\n"));
}

export function parseDiffIntoSections(diff: string): FileDiffSection[] {
  const trimmed = diff.replace(/\r\n/g, "\n").trim();
  if (!trimmed) {
    return [];
  }

  const chunks = splitIntoFileChunks(trimmed);
  const hasGitChunks = chunks.some((c) => c.includes("diff --git "));
  const toIterate = hasGitChunks && chunks.length > 1 ? chunks : [trimmed];

  const sections: FileDiffSection[] = [];

  for (const chunk of toIterate) {
    const path = hasGitChunks && chunk.includes("diff --git ") ? extractPathFromChunk(chunk) : extractPathFromChunk(chunk);
    const lines = parseChunkToLines(chunk);
    if (lines.length === 0) {
      continue;
    }
    let added = 0;
    let removed = 0;
    for (const l of lines) {
      if (l.type === "added") {
        added += 1;
      }
      if (l.type === "removed") {
        removed += 1;
      }
    }
    sections.push({ path, lines, added, removed });
  }

  return sections;
}

function diffLineSign(type: DiffLine["type"]): string {
  switch (type) {
    case "added":
      return "+";
    case "removed":
      return "-";
    case "context":
      return " ";
    case "header":
      return "";
  }
}

function DiffLineRows({ lines }: { readonly lines: DiffLine[] }) {
  return (
    <>
      {lines.map((line, index) => (
        <div className={`diff-line diff-line--${line.type}`} key={index}>
          <span className="diff-line__sign" aria-hidden="true">
            {diffLineSign(line.type)}
          </span>
          {line.lineNumber !== undefined ? (
            <span className="diff-line__number">{line.lineNumber}</span>
          ) : (
            <span className="diff-line__number" />
          )}
          <span className="diff-line__content">{line.content}</span>
        </div>
      ))}
    </>
  );
}

function DiffFileCard({ section, defaultOpen }: { readonly section: FileDiffSection; readonly defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((v) => !v);
    }
  };

  return (
    <div className="diff-file">
      <button
        type="button"
        className="diff-file__header"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
      >
        <span className={`diff-file__chevron ${open ? "diff-file__chevron--expanded" : ""}`}>
          <ChevronRightIcon />
        </span>
        <span className="diff-file__path">{section.path}</span>
        <span className="diff-file__stats">
          <span className="diff-stat-add">+{section.added}</span>
          <span className="diff-stat-del">-{section.removed}</span>
        </span>
      </button>
      {open ? (
        <div className="diff-file__body">
          <pre className="diff-inline diff-inline--file">
            <DiffLineRows lines={section.lines} />
          </pre>
        </div>
      ) : null}
    </div>
  );
}

export function InlineDiff({ diff }: { readonly diff: string }) {
  const sections = useMemo(() => parseDiffIntoSections(diff), [diff]);
  if (sections.length === 0) {
    return null;
  }

  const totalAdded = sections.reduce((s, x) => s + x.added, 0);
  const totalRemoved = sections.reduce((s, x) => s + x.removed, 0);
  const multi = sections.length > 1;

  if (!multi) {
    const only = sections[0]!;
    return (
      <div className="diff-document diff-document--single">
        <pre className="diff-inline">
          <DiffLineRows lines={only.lines} />
        </pre>
      </div>
    );
  }

  return (
    <div className="diff-document diff-document--multi">
      <div className="diff-document__summary">
        <span className="diff-document__summary-label">{sections.length} files changed</span>
        <span className="diff-document__summary-stats">
          <span className="diff-stat-add">+{totalAdded}</span>
          <span className="diff-stat-del">-{totalRemoved}</span>
        </span>
      </div>
      <div className="diff-document__files">
        {sections.map((sec, i) => (
          <DiffFileCard key={`${sec.path}:${i}`} section={sec} defaultOpen={i === 0} />
        ))}
      </div>
    </div>
  );
}

export function parseDiff(diff: string): DiffLine[] {
  return parseDiffLines(diff.split("\n"));
}

/** Cap synthetic `write` patches so huge pastes do not freeze the timeline DOM. */
const MAX_SYNTH_WRITE_DIFF_LINES = 500;

function normalizeWriteToolNewlines(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Pi's `write` tool only returns a short success message in `output` — no `details.diff`.
 * Build an all-additions unified diff from tool args so the timeline can show +/- stats and InlineDiff.
 */
export function syntheticUnifiedDiffFromWriteToolInput(input: unknown): string | undefined {
  if (!isObj(input)) {
    return undefined;
  }
  const rawPath = input.file_path ?? input.path ?? input.filename;
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    return undefined;
  }
  if (typeof input.content !== "string") {
    return undefined;
  }
  const path = rawPath.trim().replace(/\\/g, "/");
  const normalized = normalizeWriteToolNewlines(input.content);
  const allLines = normalized.length === 0 ? [] : normalized.split("\n");

  let displayLines = allLines;
  let omitted = 0;
  if (allLines.length > MAX_SYNTH_WRITE_DIFF_LINES) {
    displayLines = allLines.slice(0, MAX_SYNTH_WRITE_DIFF_LINES);
    omitted = allLines.length - MAX_SYNTH_WRITE_DIFF_LINES;
  }

  const lineCount = displayLines.length + (omitted > 0 ? 1 : 0);
  const [newStart, newCount] = lineCount === 0 ? [0, 0] : [1, lineCount];
  let diff = `diff --git a/${path} b/${path}\n`;
  diff += `--- /dev/null\n`;
  diff += `+++ b/${path}\n`;
  diff += `@@ -0,0 +${newStart},${newCount} @@\n`;
  for (const line of displayLines) {
    diff += `+${line}\n`;
  }
  if (omitted > 0) {
    diff += `+… (${omitted} more lines not shown)\n`;
  }
  return diff;
}

export function extractDiffFromOutput(output: unknown): string | undefined {
  if (typeof output === "string" && (output.includes("@@") || output.startsWith("diff "))) {
    return output;
  }
  if (isObj(output)) {
    if (typeof output.diff === "string") {
      return output.diff;
    }
    if (isObj(output.details) && typeof output.details.diff === "string") {
      return output.details.diff;
    }
    if (Array.isArray(output.content)) {
      for (const part of output.content) {
        if (isObj(part) && part.type === "text" && typeof part.text === "string") {
          if (part.text.includes("@@") || part.text.startsWith("diff ")) {
            return part.text;
          }
        }
      }
    }
  }
  return undefined;
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
