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
  const { theme, toggleTheme, mounted } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={
        variant === "labeled"
          ? `inline-flex items-center gap-2 border border-border bg-background px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] text-foreground transition-colors hover:bg-secondary/80 ${className}`
          : `inline-flex h-9 w-9 shrink-0 items-center justify-center border border-border bg-background text-foreground transition-colors hover:bg-secondary/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground ${className}`
      }
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={isDark}
      title={isDark ? "Light mode" : "Dark mode"}
    >
      {!mounted ? (
        <Sun className="h-4 w-4 opacity-40" strokeWidth={1.5} aria-hidden />
      ) : isDark ? (
        <Sun className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      ) : (
        <Moon className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      )}
      {variant === "labeled" ? (
        <span>{mounted ? (isDark ? "Light" : "Dark") : "Theme"}</span>
      ) : null}
    </button>
  );
}
