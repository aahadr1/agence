"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

type CredRow = {
  id: string;
  label: string;
  hostname: string;
  kind: "cookies" | "basic_auth";
  created_at: string;
  updated_at: string;
};

export function BrowserCredentialsPanel({
  sessionId,
  orgId,
}: {
  sessionId: string;
  orgId: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<CredRow[]>([]);
  const [label, setLabel] = useState("");
  const [hostname, setHostname] = useState("");
  const [cookiesJson, setCookiesJson] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/browser-credentials");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText);
      setItems(j.credentials || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur chargement");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (!open || !orgId) return;
    void load();
  }, [open, orgId, load, sessionId]);

  const handleAdd = async () => {
    if (!orgId) return;
    setSaving(true);
    setError(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(cookiesJson);
      } catch {
        throw new Error("JSON cookies invalide — tableau [...] ou { \"cookies\": [...] }");
      }
      let cookies: unknown;
      if (Array.isArray(parsed)) cookies = parsed;
      else if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { cookies?: unknown }).cookies)
      ) {
        cookies = (parsed as { cookies: unknown[] }).cookies;
      } else {
        throw new Error("Le JSON doit être un tableau de cookies ou { \"cookies\": [...] }");
      }
      const res = await fetch("/api/agent/browser-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label || hostname,
          hostname,
          kind: "cookies",
          cookies,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText);
      setLabel("");
      setHostname("");
      setCookiesJson("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/agent/browser-credentials/${id}`, {
        method: "DELETE",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  };

  if (!orgId) return null;

  return (
    <div className="border-b border-[var(--border)] bg-[var(--muted)]/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-[12.5px] font-medium text-[var(--foreground)] hover:bg-[var(--muted)]/50"
      >
        <span className="inline-flex items-center gap-2">
          <KeyRound className="h-3.5 w-3.5 opacity-70" />
          Identifiants navigateur (cookies)
        </span>
        <span className="text-[11px] font-normal text-muted-foreground">
          {open ? "Masquer" : "Configurer"}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-[var(--border)] px-4 py-3 text-[12px]">
          <p className="text-muted-foreground leading-relaxed">
            Quand LinkedIn, Meta ou un autre site bloque l’agent (mur de
            connexion), exportez les cookies de <strong>votre</strong> session
            connectée (extension type « Cookie-Editor », format JSON) et
            collez-les ici. Ils sont chiffrés (AGENT_ENCRYPTION_KEY) et injectés
            dans Playwright pour cette organisation uniquement.
          </p>

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-[11px] text-muted-foreground">Libellé</span>
              <input
                className={cn(
                  "rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5",
                  "text-[12px] outline-none focus:ring-1 focus:ring-[var(--ring)]",
                )}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="ex. LinkedIn perso"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] text-muted-foreground">
                Domaine ou URL
              </span>
              <input
                className={cn(
                  "rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5",
                  "text-[12px] outline-none focus:ring-1 focus:ring-[var(--ring)]",
                )}
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                placeholder="linkedin.com ou https://www.linkedin.com/"
              />
            </label>
          </div>

          <label className="grid gap-1">
            <span className="text-[11px] text-muted-foreground">
              JSON cookies (tableau Playwright)
            </span>
            <textarea
              className={cn(
                "min-h-[100px] w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 font-mono text-[11px]",
                "outline-none focus:ring-1 focus:ring-[var(--ring)]",
              )}
              value={cookiesJson}
              onChange={(e) => setCookiesJson(e.target.value)}
              placeholder='[{"name":"li_at","value":"...","domain":".linkedin.com","path":"/"}]'
            />
          </label>

          <button
            type="button"
            disabled={saving || !hostname.trim() || !cookiesJson.trim()}
            onClick={() => void handleAdd()}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md bg-[var(--foreground)] px-3 py-1.5 text-[12px] font-medium text-[var(--background)]",
              "disabled:opacity-40",
            )}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Enregistrer
          </button>

          <div className="border-t border-[var(--border)] pt-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">
                Entrées ({items.length})
              </span>
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin opacity-60" />}
            </div>
            {items.length === 0 && !loading ? (
              <p className="text-[11px] text-muted-foreground">Aucune entrée.</p>
            ) : (
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {items.map((it) => (
                  <li
                    key={it.id}
                    className="flex items-center justify-between gap-2 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{it.label}</div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {it.hostname} · {it.kind}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="Supprimer"
                      onClick={() => void handleDelete(it.id)}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
