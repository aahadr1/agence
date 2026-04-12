"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme-provider";

type ThemeToggleProps = {
  /** Compact icon-only (default) or with visible label */
  variant?: "icon" | "labeled";
  className?: string;
};

export function ThemeToggle({
  variant = "icon",
  className = "",
}: ThemeToggleProps) {
  const { toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      suppressHydrationWarning
      className={
        variant === "labeled"
          ? `inline-flex items-center gap-2 border border-border bg-background px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] text-foreground transition-colors hover:bg-secondary/80 ${className}`
          : `inline-flex h-9 w-9 shrink-0 items-center justify-center border border-border bg-background text-foreground transition-colors hover:bg-secondary/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground ${className}`
      }
      aria-label="Toggle color theme"
      title="Toggle light / dark mode"
    >
      {/* Icons follow <html class="dark"> (set by inline script) to avoid hydration mismatch */}
      <Moon className="h-4 w-4 dark:hidden" strokeWidth={1.5} aria-hidden />
      <Sun className="hidden h-4 w-4 dark:block" strokeWidth={1.5} aria-hidden />
      {variant === "labeled" ? (
        <>
          <span className="dark:hidden">Dark</span>
          <span className="hidden dark:inline">Light</span>
        </>
      ) : null}
    </button>
  );
}
