"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  BookOpen,
  KanbanSquare,
  LayoutDashboard,
  Radar,
  Sparkles,
  Table2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type GuideSection = "overview" | "crm" | "leads" | "workspace";

type GuideContextValue = {
  openGuide: (section?: GuideSection) => void;
};

const GuideOpenContext = createContext<GuideContextValue | null>(null);

export function useProductGuide() {
  const v = useContext(GuideOpenContext);
  if (!v) {
    throw new Error("useProductGuide must be used within ProductGuideProvider");
  }
  return v;
}

const SECTIONS: {
  id: GuideSection;
  label: string;
  icon: typeof LayoutDashboard;
  blocks: { title: string; body: string }[];
}[] = [
  {
    id: "overview",
    label: "Overview",
    icon: Sparkles,
    blocks: [
      {
        title: "Welcome",
        body: "This workspace brings your pipeline, files, calendar, and lead tools into one place. Use the guide anytime via the help button — it stays available on every screen.",
      },
      {
        title: "First steps",
        body: "Open CRM to manage deals, or Lead generator to source new companies. Notifications and theme live in the sidebar (menu on mobile).",
      },
    ],
  },
  {
    id: "crm",
    label: "CRM",
    icon: KanbanSquare,
    blocks: [
      {
        title: "List & board",
        body: "The table view is for sorting, filtering, and bulk actions. Switch to Board for a kanban by stage — drag cards to move deals.",
      },
      {
        title: "Prospect detail",
        body: "Open any row to edit amount, probability, and stage. Log activities and tasks on the timeline so nothing falls through.",
      },
      {
        title: "Saved views & export",
        body: "Save filter combinations as views for repeat use. Export the current list when you need a spreadsheet or backup.",
      },
    ],
  },
  {
    id: "leads",
    label: "Lead generator",
    icon: Radar,
    blocks: [
      {
        title: "Search & lists",
        body: "Run searches, build lists, and enrich contacts. Results can feed your CRM when you mark prospects ready to contact.",
      },
    ],
  },
  {
    id: "workspace",
    label: "Workspace",
    icon: LayoutDashboard,
    blocks: [
      {
        title: "Drive & calendar",
        body: "Drive is for shared documents; Calendar keeps meetings visible. Each area uses the same neutral chrome so you stay focused on content.",
      },
    ],
  },
];

function GuidePanel({
  open,
  active,
  onClose,
  onSection,
}: {
  open: boolean;
  active: GuideSection;
  onClose: () => void;
  onSection: (s: GuideSection) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const current = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  return (
    <div className="fixed inset-0 z-[100] flex justify-end" role="dialog" aria-modal aria-labelledby="product-guide-title">
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
        aria-label="Close guide"
      />
      <aside
        className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-2xl motion-reduce:transition-none"
        style={{ animation: "fadeIn 0.28s ease-out forwards" }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="label-eyebrow">Help</p>
            <h2 id="product-guide-title" className="font-display mt-1 text-xl font-medium tracking-tight text-display-title">
              Product guide
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Short tours you can reopen whenever you need them.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-[var(--radius)] p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2 scrollbar-hide">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const isOn = active === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSection(s.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-[var(--radius)] px-3 py-1.5 text-xs font-medium transition-colors",
                  isOn
                    ? "bg-foreground text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                {s.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="space-y-6">
            {current.blocks.map((b) => (
              <div key={b.title}>
                <h3 className="text-sm font-semibold text-foreground">{b.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{b.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 rounded-[var(--radius)] border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
              <Table2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              Tip
            </span>
            <p className="mt-2 leading-relaxed">
              Press <kbd className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd>{" "}
              to close this panel. The floating button stays in the corner on desktop and mobile.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

export function ProductGuideProvider({ children }: { children: ReactNode }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [section, setSection] = useState<GuideSection>("overview");

  const openGuide = useCallback((s?: GuideSection) => {
    if (s) setSection(s);
    setPanelOpen(true);
  }, []);

  return (
    <GuideOpenContext.Provider value={{ openGuide }}>
      {children}
      <GuidePanel
        open={panelOpen}
        active={section}
        onClose={() => setPanelOpen(false)}
        onSection={setSection}
      />
      <button
        type="button"
        onClick={() => openGuide()}
        className={cn(
          "fixed z-[45] flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg transition-all",
          "hover:border-foreground/20 hover:shadow-xl",
          "bottom-[max(1rem,env(safe-area-inset-bottom,0px))] right-[max(1rem,env(safe-area-inset-right,0px))]",
          "lg:bottom-8 lg:right-8"
        )}
        aria-label="Open product guide"
        title="Help & guide"
      >
        <BookOpen className="h-5 w-5" strokeWidth={1.5} />
      </button>
    </GuideOpenContext.Provider>
  );
}
