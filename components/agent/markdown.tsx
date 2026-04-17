"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { memo } from "react";
import { cn } from "@/lib/utils";

interface MarkdownProps {
  content: string;
  className?: string;
  /** Compact mode for inline/dense contexts (reflections, nudges). */
  compact?: boolean;
}

/**
 * Assistant-facing markdown renderer. Lightweight styling via element
 * class overrides to keep everything inside the chat column. No HTML.
 */
function MarkdownInner({ content, className, compact }: MarkdownProps) {
  return (
    <div
      className={cn(
        "agent-md",
        compact && "agent-md--compact",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{children}</p>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-[var(--blue)]/50 underline-offset-2 hover:decoration-[var(--blue)]"
            >
              {children}
            </a>
          ),
          code({ className: codeClass, children, ...props }) {
            const isInline = !/language-/.test(codeClass || "");
            if (isInline) {
              return (
                <code
                  className="rounded bg-[var(--muted)] px-1 py-0.5 font-mono text-[0.85em]"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className={cn("font-mono text-[12.5px] leading-relaxed", codeClass)}
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3 text-[12.5px] leading-relaxed">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="w-full border-collapse text-left text-[12.5px]">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-[var(--border)] bg-[var(--muted)] px-3 py-1.5 font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-[var(--border)] px-3 py-1.5 align-top">
              {children}
            </td>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-[var(--blue)] pl-3 text-[var(--muted-foreground)]">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-[var(--border)]" />,
          ul: ({ children }) => <ul>{children}</ul>,
          ol: ({ children }) => <ol>{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownInner);
