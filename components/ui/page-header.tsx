import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  className,
  children,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-5 border-b border-border pb-7 md:gap-6 md:pb-10 md:flex-row md:items-end md:justify-between",
        className
      )}
    >
      <div className="min-w-0 max-w-2xl space-y-2 md:space-y-3">
        {eyebrow ? (
          <p className="label-eyebrow">{eyebrow}</p>
        ) : null}
        <h1
          className="font-display text-2xl font-medium tracking-tight sm:text-3xl md:text-4xl"
          style={{ color: "var(--blue)" }}
        >
          {title}
        </h1>
        {description != null && description !== "" ? (
          <div className="text-sm leading-relaxed text-muted-foreground md:text-[15px]">
            {description}
          </div>
        ) : null}
      </div>
      {children ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 md:gap-3">{children}</div>
      ) : null}
    </header>
  );
}
