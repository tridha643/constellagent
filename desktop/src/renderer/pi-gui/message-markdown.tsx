import type { ReactNode } from "react";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MarkdownRenderer } from "@/components/MarkdownRenderer/MarkdownRenderer";
import { segmentMessageForInlineChips, type MessageSegment } from "./message-inline-segments";

const REMARK_PLUGINS = [remarkGfm];

const MARKDOWN_COMPONENTS = {
  code: ({ className, children }: { className?: string; children?: ReactNode }) => {
    const language = className?.replace(/^language-/, "");
    const code = String(children).replace(/\n$/, "");
    if (!className) {
      return <code>{code}</code>;
    }
    return (
      <pre data-language={language}>
        <code className={className}>{code}</code>
      </pre>
    );
  },
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a href={href} rel="noreferrer" target="_blank">
      {children}
    </a>
  ),
} as const;

/** Paragraphs as spans so chips + markdown can sit on one inline flow inside the bubble. */
const MARKDOWN_COMPONENTS_INLINE = {
  ...MARKDOWN_COMPONENTS,
  p: ({ children }: { children?: ReactNode }) => <span className="message__md-p">{children}</span>,
} as const;

function segmentToNode(segment: MessageSegment, index: number): ReactNode {
  switch (segment.kind) {
    case "text":
      return (
        <ReactMarkdown key={`t-${index}`} remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS_INLINE}>
          {segment.text}
        </ReactMarkdown>
      );
    case "file":
      return (
        <span key={`f-${index}`} className="pi-inline-chip pi-inline-chip--file" title={segment.path}>
          <span className="pi-inline-chip__glyph" aria-hidden>
            #
          </span>
          <span className="pi-inline-chip__label">{segment.display}</span>
        </span>
      );
    case "skillFile":
      return (
        <span key={`sf-${index}`} className="pi-inline-chip pi-inline-chip--skill" title={segment.path}>
          <span className="pi-inline-chip__label">{segment.display}</span>
        </span>
      );
    case "skillSlash":
      return (
        <span key={`ss-${index}`} className="pi-inline-chip pi-inline-chip--skill" title={segment.slash}>
          <span className="pi-inline-chip__label">{segment.slash}</span>
        </span>
      );
    default:
      return null;
  }
}

export function MessageMarkdown({
  text,
  preferStreamdown = false,
  isStreaming = false,
}: {
  readonly text: string;
  /** Use Streamdown (Shiki, GFM) when there are no inline file/skill chips. */
  readonly preferStreamdown?: boolean;
  readonly isStreaming?: boolean;
}) {
  const segments = useMemo(() => segmentMessageForInlineChips(text), [text]);
  const hasChips = segments.some((s) => s.kind !== "text");
  const shouldUseStreamdown = preferStreamdown && !isStreaming;

  const variant = hasChips ? "segmented" : shouldUseStreamdown ? "streamdown" : "plain";

  return (
    <div className="message__content">
      <div key={variant} className="message__content-variant" data-variant={variant}>
        {hasChips ? (
          <div className="message__content--segmented">{segments.map((seg, i) => segmentToNode(seg, i))}</div>
        ) : shouldUseStreamdown ? (
          <MarkdownRenderer isStreaming={isStreaming} className="message__streamdown">
            {text}
          </MarkdownRenderer>
        ) : (
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
            {text}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}
