/**
 * Splits PI Chat message text into plain markdown chunks and inline chip hits
 * (file paths, SKILL.md paths, slash-style skills) for Cursor-like pills.
 * Fenced ``` code blocks and inline `code` spans are left as plain text (no chips inside).
 */

export type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "file"; path: string; display: string }
  | { kind: "skillFile"; path: string; display: string }
  | { kind: "skillSlash"; slash: string; name: string };

type RawMatch = {
  start: number;
  end: number;
  segment: Exclude<MessageSegment, { kind: "text" }>;
};

const EXT =
  "tsx?|mjsx?|jsx?|css|json|mdx?|md|less|scss|html|svg|rs|go|py|lock|toml|yaml|yml|wasm|mjs|cjs|vue|svelte|mts|cts";

/**
 * Absolute POSIX path — must include a second `/` so `/nia` is not a file (skill slash instead).
 * Includes common single-segment roots like `/tmp`.
 */
const ABS_PATH =
  /\/(?:[a-zA-Z0-9][a-zA-Z0-9._-]*\/)+[a-zA-Z0-9][a-zA-Z0-9._-]*|\/(?:tmp|var|usr|etc|opt|dev|bin|mnt|srv|sys|Volumes)(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*/g;

/** Windows absolute path. */
const WIN_PATH = /[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]+/g;

/**
 * Repo-relative path with extension: desktop/src/foo.ts
 * Requires at least one slash and a known extension.
 */
const REL_FILE = new RegExp(
  String.raw`(?<![\w/])([a-zA-Z0-9][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9_.-]*)+\.(?:${EXT}))`,
  "g",
);

/** Slash command: /nia — not /Users (uppercase after / breaks [a-z] first char). */
const SKILL_SLASH = /(?:^|[\s([{`'"])\/([a-z][a-z0-9_-]{0,63})(?=\s|$|[.,;:!?)}\]`'"])/g;

function isSkillMdPath(p: string): boolean {
  return /SKILL\.md$/i.test(p);
}

function shortenDisplay(path: string, maxLen = 42): string {
  if (path.length <= maxLen) return path;
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path.slice(-maxLen);
  return parts.slice(-3).join("/");
}

function collectMatchesInSlice(s: string, offset: number): RawMatch[] {
  const out: RawMatch[] = [];

  const pushFile = (path: string, start: number, end: number) => {
    const display = shortenDisplay(path);
    if (isSkillMdPath(path)) {
      out.push({
        start,
        end,
        segment: { kind: "skillFile", path, display },
      });
    } else {
      out.push({
        start,
        end,
        segment: { kind: "file", path, display },
      });
    }
  };

  for (const re of [ABS_PATH, WIN_PATH]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      const path = m[0];
      const start = offset + m.index;
      const end = start + path.length;
      pushFile(path, start, end);
    }
  }

  REL_FILE.lastIndex = 0;
  let rm: RegExpExecArray | null;
  while ((rm = REL_FILE.exec(s)) !== null) {
    const path = rm[1];
    const start = offset + rm.index + (rm[0].length - path.length);
    const end = start + path.length;
    pushFile(path, start, end);
  }

  SKILL_SLASH.lastIndex = 0;
  let sm: RegExpExecArray | null;
  while ((sm = SKILL_SLASH.exec(s)) !== null) {
    const name = sm[1];
    if (!name) continue;
    const slash = `/${name}`;
    const innerStart = sm.index + sm[0].indexOf("/");
    const start = offset + innerStart;
    const end = start + slash.length;
    out.push({
      start,
      end,
      segment: { kind: "skillSlash", slash, name },
    });
  }

  return out;
}

/** Drop overlaps: prefer longer spans, then earlier start, then file > skillFile > skillSlash. */
function resolveOverlaps(matches: RawMatch[]): RawMatch[] {
  const priority = (k: MessageSegment["kind"]) => {
    if (k === "file") return 3;
    if (k === "skillFile") return 2;
    if (k === "skillSlash") return 1;
    return 0;
  };

  const sorted = [...matches].sort((a, b) => {
    const la = a.end - a.start;
    const lb = b.end - b.start;
    if (lb !== la) return lb - la;
    if (a.start !== b.start) return a.start - b.start;
    return priority(b.segment.kind) - priority(a.segment.kind);
  });

  const taken: RawMatch[] = [];
  for (const m of sorted) {
    if (taken.some((t) => !(m.end <= t.start || m.start >= t.end))) {
      continue;
    }
    taken.push(m);
  }
  taken.sort((a, b) => a.start - b.start);
  return taken;
}

function segmentSliceWithChips(slice: string, offset: number): MessageSegment[] {
  if (!slice) return [];
  const matches = resolveOverlaps(collectMatchesInSlice(slice, offset));
  if (matches.length === 0) {
    return [{ kind: "text", text: slice }];
  }

  const out: MessageSegment[] = [];
  let cursor = 0;
  for (const m of matches) {
    const localStart = m.start - offset;
    const localEnd = m.end - offset;
    if (localStart > cursor) {
      out.push({ kind: "text", text: slice.slice(cursor, localStart) });
    }
    out.push(m.segment);
    cursor = localEnd;
  }
  if (cursor < slice.length) {
    out.push({ kind: "text", text: slice.slice(cursor) });
  }
  return out;
}

/** Split out ``` fenced ``` regions (GFM-style). Inline text may still contain `code`. */
function splitOutFencedCode(input: string): Array<{ text: string; code: boolean }> {
  const parts: Array<{ text: string; code: boolean }> = [];
  let i = 0;
  while (i < input.length) {
    const fence = input.indexOf("```", i);
    if (fence === -1) {
      parts.push({ text: input.slice(i), code: false });
      break;
    }
    if (fence > i) {
      parts.push({ text: input.slice(i, fence), code: false });
    }
    const langEnd = input.indexOf("\n", fence + 3);
    const bodyStart = langEnd === -1 ? fence + 3 : langEnd + 1;
    const close = input.indexOf("```", bodyStart);
    if (close === -1) {
      parts.push({ text: input.slice(fence), code: false });
      break;
    }
    parts.push({ text: input.slice(fence, close + 3), code: true });
    i = close + 3;
  }
  return parts;
}

/** Inside a non-fence segment, skip inline `single-backtick` spans for chip matching. */
function splitOutInlineCode(text: string): Array<{ text: string; code: boolean }> {
  const parts: Array<{ text: string; code: boolean }> = [];
  let i = 0;
  while (i < text.length) {
    const bt = text.indexOf("`", i);
    if (bt === -1) {
      parts.push({ text: text.slice(i), code: false });
      break;
    }
    if (bt > i) {
      parts.push({ text: text.slice(i, bt), code: false });
    }
    const close = text.indexOf("`", bt + 1);
    if (close === -1) {
      parts.push({ text: text.slice(bt), code: false });
      break;
    }
    parts.push({ text: text.slice(bt, close + 1), code: true });
    i = close + 1;
  }
  return parts;
}

/**
 * Public entry: segment full message for inline chips. Respects fenced blocks and inline `code`.
 */
export function segmentMessageForInlineChips(input: string): MessageSegment[] {
  const out: MessageSegment[] = [];
  let globalOffset = 0;

  for (const block of splitOutFencedCode(input)) {
    if (block.code) {
      out.push({ kind: "text", text: block.text });
      globalOffset += block.text.length;
      continue;
    }

    for (const piece of splitOutInlineCode(block.text)) {
      if (piece.code) {
        out.push({ kind: "text", text: piece.text });
        globalOffset += piece.text.length;
        continue;
      }
      const segs = segmentSliceWithChips(piece.text, globalOffset);
      out.push(...segs);
      globalOffset += piece.text.length;
    }
  }

  return mergeAdjacentText(out);
}

function mergeAdjacentText(segments: MessageSegment[]): MessageSegment[] {
  const merged: MessageSegment[] = [];
  for (const s of segments) {
    if (s.kind === "text" && merged.length > 0 && merged[merged.length - 1].kind === "text") {
      const prev = merged[merged.length - 1] as { kind: "text"; text: string };
      prev.text += s.text;
    } else {
      merged.push(s);
    }
  }
  return merged;
}
