import { useMemo, useState, type KeyboardEvent } from "react";
import { ChevronRightIcon } from "./icons";
import {
  type DiffLine,
  type FileDiffSection,
  countDiffFiles,
  extractDiffFromOutput,
  parseDiff,
  parseDiffIntoSections,
  syntheticUnifiedDiffFromWriteToolInput,
} from "./diff-core";

export type { FileDiffSection } from "./diff-core";
export {
  countDiffFiles,
  extractDiffFromOutput,
  parseDiff,
  parseDiffIntoSections,
  syntheticUnifiedDiffFromWriteToolInput,
} from "./diff-core";

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

/** Summary row + expandable per-file diffs (used in timeline tools and post-run footer). */
export function InlineDiffSections({ sections }: { readonly sections: readonly FileDiffSection[] }) {
  if (sections.length === 0) {
    return null;
  }

  const totalAdded = sections.reduce((s, x) => s + x.added, 0);
  const totalRemoved = sections.reduce((s, x) => s + x.removed, 0);

  return (
    <div className="diff-document diff-document--multi">
      <div className="diff-document__summary">
        <span className="diff-document__summary-label">
          {sections.length} file{sections.length === 1 ? "" : "s"} changed
        </span>
        <span className="diff-document__summary-stats">
          <span className="diff-stat-add">+{totalAdded}</span>
          <span className="diff-stat-del">-{totalRemoved}</span>
        </span>
      </div>
      <div className="diff-document__files">
        {sections.map((sec, i) => (
          <DiffFileCard
            key={`${sec.path}:${i}`}
            section={sec}
            defaultOpen={sections.length === 1 || i === 0}
          />
        ))}
      </div>
    </div>
  );
}

export function InlineDiff({ diff }: { readonly diff: string }) {
  const sections = useMemo(() => parseDiffIntoSections(diff), [diff]);
  if (sections.length === 0) {
    return null;
  }

  if (sections.length === 1) {
    const only = sections[0]!;
    return (
      <div className="diff-document diff-document--single">
        <pre className="diff-inline">
          <DiffLineRows lines={only.lines} />
        </pre>
      </div>
    );
  }

  return <InlineDiffSections sections={sections} />;
}
