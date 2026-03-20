"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { NAV_ITEMS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import {
  Globe,
  LayoutDashboard,
  LogOut,
  Search,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const iconMap = {
  LayoutDashboard,
  Globe,
  Search,
} as const;

export function Sidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  return (
    <aside
      className="fixed left-0 top-0 z-40 flex h-screen w-[var(--sidebar-width)] flex-col border-r border-border bg-card"
      style={{ width: "var(--sidebar-width)" }}
    >
      <div className="flex flex-col gap-1 border-b border-border px-6 py-8">
        <Link href="/dashboard" className="group">
          <span className="font-display text-lg font-medium tracking-tight text-foreground">
            Agence
          </span>
        </Link>
        <span className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
          Studio
        </span>
      </div>

      <nav className="flex-1 px-3 py-8">
        <p className="label-eyebrow mb-4 px-3">Navigate</p>
        <ul className="space-y-0">
          {NAV_ITEMS.map((item) => {
            const Icon = iconMap[item.icon];
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "relative flex items-center gap-3 border-l-2 border-transparent py-2.5 pr-3 pl-[calc(0.75rem-2px)] text-[13px] font-medium transition-colors",
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  style={isActive ? { borderLeftColor: "var(--blue)" } : undefined}
                >
                  <Icon
                    className="h-4 w-4 shrink-0"
                    strokeWidth={1.5}
                    style={isActive ? { color: "var(--blue)", opacity: 1 } : { opacity: 0.7 }}
                  />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-border px-5 py-5">
        <div className="mb-3 flex justify-end">
          <ThemeToggle />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-border text-[10px] font-semibold tracking-wide text-foreground uppercase">
            {user?.email?.charAt(0) || "U"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-foreground">
              {user?.email || "User"}
            </p>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="shrink-0 p-2 text-muted-foreground transition-colors hover:text-foreground"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </aside>
  );
}
