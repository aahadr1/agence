import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface PanelProps {
  children: ReactNode;
  className?: string;
  /** Padding variant */
  padding?: "none" | "sm" | "md" | "lg";
}

const paddingMap = {
  none: "",
  sm: "p-4 md:p-5",
  md: "p-6 md:p-8",
  lg: "p-8 md:p-10",
};

export function Panel({
  children,
  className,
  padding = "md",
}: PanelProps) {
  return (
    <div
      className={cn(
        "border border-border bg-card",
        paddingMap[padding],
        className
      )}
    >
      {children}
    </div>
  );
}
