"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export function NotificationBell() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<
    { id: string; title: string; body: string | null }[]
  >([]);

  const load = async () => {
    try {
      const res = await fetch("/api/notifications");
      const data = await res.json();
      if (res.ok) {
        const list = data.notifications || [];
        setItems(list);
        setCount(list.length);
      }
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
    const id = window.setInterval(() => {
      void load();
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const markAll = async () => {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAll: true }),
    });
    setOpen(false);
    load();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) load();
        }}
        className="relative p-2 text-muted-foreground transition-colors hover:text-foreground"
        title="Notifications"
      >
        <Bell className="h-4 w-4" strokeWidth={1.5} />
        {count > 0 && (
          <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center bg-primary px-0.5 text-[9px] font-semibold text-primary-foreground">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-2 w-72 border border-border bg-card p-2 shadow-lg">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Notifications
            </span>
            <button
              type="button"
              onClick={markAll}
              className="text-[10px] text-primary hover:underline"
            >
              Tout lu
            </button>
          </div>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
            {items.length === 0 ? (
              <li className="px-2 py-3 text-muted-foreground">Rien pour l’instant.</li>
            ) : (
              items.map((n) => (
                <li key={n.id} className="border-b border-border px-2 py-2 last:border-0">
                  <p className="font-medium text-foreground">{n.title}</p>
                  {n.body && (
                    <p className="mt-0.5 text-muted-foreground line-clamp-2">{n.body}</p>
                  )}
                  <Link
                    href="/messages"
                    className="mt-1 inline-block text-[10px] text-primary"
                    onClick={() => setOpen(false)}
                  >
                    Messagerie
                  </Link>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
