"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { NAV_ITEMS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import {
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const iconMap = {
  LayoutDashboard,
  Globe,
  Search,
} as const;

// ─── shared nav list ───────────────────────────────────────────────────────
function NavList({
  pathname,
  onNavClick,
}: {
  pathname: string;
  onNavClick?: () => void;
}) {
  return (
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
                onClick={onNavClick}
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
                  style={
                    isActive
                      ? { color: "var(--blue)", opacity: 1 }
                      : { opacity: 0.7 }
                  }
                />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ─── shared user row ────────────────────────────────────────────────────────
function UserRow({ onSignOut }: { onSignOut: () => void }) {
  const { user } = useAuth();
  return (
    <div className="border-t border-border px-5 py-5">
      <div className="mb-3 flex justify-end">
        <ThemeToggle />
      </div>
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-border text-[10px] font-semibold uppercase tracking-wide text-foreground">
          {user?.email?.charAt(0) || "U"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-foreground">
            {user?.email || "User"}
          </p>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="shrink-0 p-2 text-muted-foreground transition-colors hover:text-foreground"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}

// ─── logo block (reused) ────────────────────────────────────────────────────
function LogoBlock({
  width = 130,
  onClick,
}: {
  width?: number;
  onClick?: () => void;
}) {
  return (
    <Link href="/dashboard" onClick={onClick} className="block">
      <div className="overflow-hidden rounded-sm bg-white p-2">
        <Image
          src="/logo.png"
          alt="LàHaut Agency"
          width={width}
          height={width / 2}
          className="h-auto w-full object-contain"
          priority
        />
      </div>
    </Link>
  );
}

// ─── main Sidebar component ─────────────────────────────────────────────────
export function Sidebar() {
  const pathname = usePathname();
  const { signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <>
      {/* ── Mobile top bar ─────────────────────────────────────────────── */}
      <header className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-card px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="flex h-9 w-9 items-center justify-center text-foreground"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" strokeWidth={1.5} />
        </button>

        <Link href="/dashboard" className="absolute left-1/2 -translate-x-1/2">
          <div className="overflow-hidden rounded-sm bg-white px-2 py-1">
            <Image
              src="/logo.png"
              alt="LàHaut Agency"
              width={90}
              height={45}
              className="h-auto w-auto object-contain"
              priority
            />
          </div>
        </Link>

        <ThemeToggle />
      </header>

      {/* ── Mobile backdrop ────────────────────────────────────────────── */}
      <div
        className={cn(
          "fixed inset-0 z-50 bg-black/40 transition-opacity duration-300 lg:hidden",
          mobileOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        )}
        onClick={() => setMobileOpen(false)}
        aria-hidden
      />

      {/* ── Mobile drawer ──────────────────────────────────────────────── */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-50 flex h-dvh w-72 flex-col border-r border-border bg-card transition-transform duration-300 ease-out lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          <LogoBlock width={110} onClick={() => setMobileOpen(false)} />
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </div>
        <NavList pathname={pathname} onNavClick={() => setMobileOpen(false)} />
        <UserRow onSignOut={signOut} />
      </aside>

      {/* ── Desktop sidebar ────────────────────────────────────────────── */}
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-[var(--sidebar-width)] flex-col border-r border-border bg-card lg:flex">
        <div className="border-b border-border px-4 py-4">
          <LogoBlock width={90} />
        </div>
        <NavList pathname={pathname} />
        <UserRow onSignOut={signOut} />
      </aside>
    </>
  );
}
