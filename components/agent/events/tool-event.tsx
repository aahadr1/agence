"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  content: string;
  tool?: string;
  status?: string;
  params?: Record<string, unknown>;
  durationMs?: number;
  summary?: string;
}

function asText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function firstParam(
  params: Record<string, unknown> | undefined,
  keys: string[],
): string | null {
  if (!params) return null;
  for (const key of keys) {
    const value = asText(params[key]);
    if (value) return value;
  }
  return null;
}

function hostFromUrl(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function actionTitle(tool?: string): string {
  switch (tool) {
    case "todo_read":
      return "Lecture du plan de travail";
    case "todo_write":
      return "Création du plan de travail";
    case "todo_update":
    case "todo_update_batch":
      return "Mise à jour du plan de travail";
    case "todo_finalize":
      return "Clôture du plan de travail";
    case "web_search":
    case "google_search":
      return "Recherche web";
    case "google_maps_search":
      return "Recherche Google Maps";
    case "web_fetch":
      return "Lecture d'une page web";
    case "browser_navigate":
      return "Ouverture dans le navigateur";
    case "browser_act":
      return "Action dans le navigateur";
    case "browser_extract":
      return "Extraction depuis la page";
    case "browser_close":
      return "Fermeture du navigateur";
    case "pappers_search":
      return "Recherche Pappers";
    case "societe_com_lookup":
      return "Vérification Societe.com";
    case "save_lead":
      return "Sauvegarde d'un prospect";
    case "batch_save_leads":
      return "Sauvegarde des prospects";
    case "ask_user":
      return "Question utilisateur";
    default:
      return tool ? `Action ${tool}` : "Action outil";
  }
}

function actionSubject(tool: string | undefined, params?: Record<string, unknown>) {
  const query = firstParam(params, ["query", "q", "search", "keywords"]);
  const url = firstParam(params, ["url", "href"]);
  const instruction = firstParam(params, ["instruction", "action"]);
  const question = firstParam(params, ["question", "schema"]);
  const id = firstParam(params, ["id", "lead_id", "business_name", "name"]);

  if (query) return `Recherche lancée pour “${query}”.`;
  if (url) return `Page ouverte ou consultée : ${hostFromUrl(url)}.`;
  if (instruction) return `Instruction exécutée : ${instruction}.`;
  if (question) return `Information demandée : ${question}.`;
  if (id) return `Élément ciblé : ${id}.`;
  if (tool?.startsWith("todo_")) return "État de mission consulté ou mis à jour.";
  return "Action exécutée par l'agent.";
}

function cleanSummary(summary: string | undefined, fallback: string): string {
  const text = (summary || fallback || "").replace(/\s+/g, " ").trim();
  if (!text) return "Aucun détail exploitable retourné.";
  return text.length > 260 ? `${text.slice(0, 257).trim()}…` : text;
}

function formatDuration(durationMs?: number): string | null {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return null;
  }
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function ToolEvent({
  content,
  tool,
  status,
  params,
  durationMs,
  summary,
}: Props) {
  const [open, setOpen] = useState(false);
  const isError = status === "error";
  const duration = formatDuration(durationMs);
  const detail = useMemo(
    () => ({
      title: actionTitle(tool),
      subject: actionSubject(tool, params),
      summary: cleanSummary(summary, content),
    }),
    [content, params, summary, tool],
  );

  return (
    <div className="animate-fade-in border-l border-[var(--border)] pl-4">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "group w-full rounded-lg border bg-[var(--card)] px-3 py-2.5 text-left transition-colors",
          "hover:bg-[var(--muted)]/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
          isError ? "border-red-500/35" : "border-[var(--border)]",
        )}
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-[12px] font-semibold text-[var(--foreground)]">
            {detail.title}
          </span>
          {tool && (
            <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--muted-foreground)]">
              {tool}
            </span>
          )}
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
              isError
                ? "bg-red-500/10 text-red-600"
                : "bg-emerald-500/10 text-emerald-600",
            )}
          >
            {isError ? "erreur" : "ok"}
          </span>
          {duration && (
            <span className="text-[10.5px] text-[var(--muted-foreground)]">
              {duration}
            </span>
          )}
          <ChevronRight
            className={cn(
              "ml-auto h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] transition-transform",
              open && "rotate-90",
            )}
            strokeWidth={1.75}
          />
        </div>
        <div className="mt-1.5 space-y-0.5">
          <p className="text-[12px] leading-relaxed text-[var(--foreground)]/85">
            {detail.subject}
          </p>
          <p className="text-[11.5px] leading-relaxed text-[var(--muted-foreground)]">
            {detail.summary}
          </p>
        </div>
      </button>

      {open && (
        <div
          className={cn(
            "mt-2 max-h-72 overflow-auto rounded-lg border border-[var(--border)]",
            "bg-[var(--muted)]/25 px-3 py-2.5 text-[11.5px] leading-relaxed",
          )}
        >
          {params && (
            <div className="mb-2">
              <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                Paramètres
              </p>
              <pre className="whitespace-pre-wrap font-mono text-[var(--foreground)]/80">
                {JSON.stringify(params, null, 2)}
              </pre>
            </div>
          )}
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Résultat brut
          </p>
          <pre className="whitespace-pre-wrap font-mono text-[var(--foreground)]/80">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}
