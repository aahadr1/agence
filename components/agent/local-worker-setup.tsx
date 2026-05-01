"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clipboard,
  Laptop,
  Loader2,
  PlugZap,
  Terminal,
  X,
} from "lucide-react";

interface WorkerStatus {
  id: string;
  label: string;
  status: string;
  last_seen_at: string | null;
  online: boolean;
}

interface RegisterResponse {
  token: string;
  appUrl: string;
  commands: string[];
}

export function LocalWorkerSetup({
  shouldPrompt,
}: {
  shouldPrompt: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(false);
  const [workers, setWorkers] = useState<WorkerStatus[]>([]);
  const [pairing, setPairing] = useState<RegisterResponse | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/local-worker/status");
      const json = await res.json().catch(() => ({}));
      setOnline(Boolean(json.online));
      setWorkers(json.workers || []);
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (shouldPrompt && !online && !dismissed) setOpen(true);
  }, [dismissed, online, shouldPrompt]);

  const startPairing = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/agent/local-worker/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Worker local" }),
      });
      const json = await res.json();
      if (res.ok) setPairing(json);
    } finally {
      setLoading(false);
    }
  }, []);

  const oneLineCommand = useMemo(() => {
    if (!pairing) return "";
    return [
      "npm install",
      "npx playwright install chromium",
      `AGENCE_APP_URL="${pairing.appUrl}" AGENCE_WORKER_TOKEN="${pairing.token}" npm run worker:local-browser`,
    ].join(" && ");
  }, [pairing]);

  const copy = async (value: string, key: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1200);
  };

  if (!shouldPrompt && !open) return null;

  return (
    <>
      <div className="border-b border-[var(--border)] bg-[var(--card)] px-4 py-2">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 text-[12px]">
          <div className="flex min-w-0 items-center gap-2">
            {online ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            ) : (
              <PlugZap className="h-4 w-4 shrink-0 text-amber-500" />
            )}
            <span className="truncate text-[var(--muted-foreground)]">
              {online
                ? "Worker local connecté : Playwright tourne sur cette machine."
                : "Worker local requis : Playwright doit tourner sur votre machine, pas sur Vercel."}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-medium hover:bg-[var(--muted)]"
          >
            <Laptop className="h-3.5 w-3.5" />
            Configurer
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <div>
                <h2 className="text-base font-semibold">Worker local Playwright</h2>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  Chaque utilisateur lance son worker. Les clés restent côté serveur.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDismissed(true);
                  setOpen(false);
                }}
                className="rounded-md p-2 hover:bg-[var(--muted)]"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="grid gap-3 text-sm md:grid-cols-3">
                <div className="rounded-md border border-[var(--border)] p-3">
                  <div className="font-medium">1. Installer</div>
                  <div className="mt-1 text-[12px] text-[var(--muted-foreground)]">
                    Node 20+, dépendances npm, Chromium Playwright.
                  </div>
                </div>
                <div className="rounded-md border border-[var(--border)] p-3">
                  <div className="font-medium">2. Appairer</div>
                  <div className="mt-1 text-[12px] text-[var(--muted-foreground)]">
                    Un token lie ce worker à votre compte.
                  </div>
                </div>
                <div className="rounded-md border border-[var(--border)] p-3">
                  <div className="font-medium">3. Lancer</div>
                  <div className="mt-1 text-[12px] text-[var(--muted-foreground)]">
                    Le worker récupère les jobs navigateur en sortie HTTPS.
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Terminal className="h-4 w-4" />
                    Commande rapide
                  </div>
                  {!pairing && (
                    <button
                      type="button"
                      onClick={() => void startPairing()}
                      disabled={loading}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[var(--foreground)] px-3 py-1.5 text-[12px] font-medium text-[var(--background)] disabled:opacity-60"
                    >
                      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Générer le token
                    </button>
                  )}
                </div>

                {pairing ? (
                  <div className="space-y-2">
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-black p-3 text-[12px] leading-relaxed text-white">
                      {oneLineCommand}
                    </pre>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void copy(oneLineCommand, "cmd")}
                        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-[12px] hover:bg-[var(--muted)]"
                      >
                        <Clipboard className="h-3.5 w-3.5" />
                        {copied === "cmd" ? "Copié" : "Copier la commande"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void refresh()}
                        className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-[12px] hover:bg-[var(--muted)]"
                      >
                        Vérifier la connexion
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[13px] text-[var(--muted-foreground)]">
                    Générez un token, puis lancez la commande dans le dossier du projet
                    sur votre machine. Aucun secret Gemini/Pappers n’est copié localement.
                  </p>
                )}
              </div>

              <div className="text-[12px] text-[var(--muted-foreground)]">
                Statut :{" "}
                {online
                  ? "connecté"
                  : workers.length
                    ? "token créé, worker non visible"
                    : "aucun worker appairé"}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
