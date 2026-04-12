"use client";

import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils";
import { normalizeToE164 } from "@/lib/telephony/phone";
import { Device, type Call } from "@twilio/voice-sdk";
import {
  ChevronDown,
  ChevronUp,
  Headphones,
  Loader2,
  Mic,
  Monitor,
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneOff,
  RefreshCw,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type CallRow = {
  id: string;
  call_sid: string;
  from_number: string | null;
  to_number: string | null;
  status: string | null;
  recording_url: string | null;
  recording_duration_sec: number | null;
  transcription: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
};

type ActiveChannel = "browser" | "mobile" | null;

export function TelephonyClient() {
  const [ready, setReady] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [call, setCall] = useState<Call | null>(null);
  const [activeCallSid, setActiveCallSid] = useState<string | null>(null);
  const [activeChannel, setActiveChannel] = useState<ActiveChannel>(null);
  const [number, setNumber] = useState("");
  const [agentPhone, setAgentPhone] = useState("");
  const [agentSaving, setAgentSaving] = useState(false);
  const [rows, setRows] = useState<CallRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const deviceRef = useRef<Device | null>(null);

  const showBanner = useCallback((type: "ok" | "err", text: string) => {
    setBanner({ type, text });
    window.setTimeout(() => setBanner(null), 5200);
  }, []);

  const loadCalls = useCallback(async () => {
    try {
      const res = await fetch("/api/telephony/calls");
      const data = await res.json();
      if (res.ok) setRows(data.calls || []);
    } catch {
      /* ignore */
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadAgent = useCallback(async () => {
    try {
      const res = await fetch("/api/telephony/agent");
      const data = await res.json();
      if (res.ok && data.phone_e164) setAgentPhone(data.phone_e164);
    } catch {
      /* ignore */
    }
  }, []);

  const clearActiveSession = useCallback(() => {
    setCall(null);
    setActiveCallSid(null);
    setActiveChannel(null);
  }, []);

  useEffect(() => {
    loadCalls();
    loadAgent();
  }, [loadCalls, loadAgent]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/telephony/token", { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
          setConfigError(data.error || "Token Twilio indisponible");
          return;
        }
        const d = new Device(data.token, { logLevel: 1 });
        d.on("registered", () => {
          if (!cancelled) setReady(true);
        });
        d.on("error", (err) => {
          console.error(err);
        });
        d.on("incoming", (c) => {
          setCall(c);
          setActiveChannel("browser");
          c.accept();
        });
        await d.register();
        if (!cancelled) {
          deviceRef.current = d;
          setDevice(d);
        }
      } catch (e) {
        if (!cancelled) {
          setConfigError(
            e instanceof Error ? e.message : "Impossible d’initialiser Twilio"
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      deviceRef.current?.destroy();
      deviceRef.current = null;
    };
  }, []);

  /** Rafraîchir les transcriptions (async Gemini) tant qu’un enregistrement n’a pas encore de texte */
  useEffect(() => {
    const pending = rows.some(
      (r) => r.recording_url && !r.transcription?.trim()
    );
    if (!pending) return;
    const id = window.setInterval(() => loadCalls(), 12_000);
    return () => window.clearInterval(id);
  }, [rows, loadCalls]);

  /** Fin d’appel mobile : libère la barre d’action quand Twilio a terminé la jambe */
  useEffect(() => {
    if (!activeCallSid || activeChannel !== "mobile") return;
    const terminal = new Set([
      "completed",
      "canceled",
      "failed",
      "busy",
      "no-answer",
    ]);
    const id = window.setInterval(async () => {
      try {
        const res = await fetch("/api/telephony/calls");
        const data = await res.json();
        if (!res.ok) return;
        const list = (data.calls as CallRow[] | undefined) ?? [];
        const row = list.find((c) => c.call_sid === activeCallSid);
        if (row?.status && terminal.has(row.status.toLowerCase())) {
          clearActiveSession();
          loadCalls();
        }
      } catch {
        /* ignore */
      }
    }, 6000);
    return () => window.clearInterval(id);
  }, [activeCallSid, activeChannel, loadCalls, clearActiveSession]);

  const hangupBrowser = () => {
    call?.disconnect();
    clearActiveSession();
  };

  const hangupMobile = async () => {
    if (!activeCallSid) return;
    setBusy(true);
    try {
      const res = await fetch("/api/telephony/hangup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callSid: activeCallSid }),
      });
      const data = await res.json();
      if (!res.ok) showBanner("err", data.error || "Impossible de raccrocher");
      else showBanner("ok", "Appel terminé.");
    } finally {
      setBusy(false);
      clearActiveSession();
      loadCalls();
    }
  };

  const hangup = () => {
    if (activeChannel === "mobile") void hangupMobile();
    else hangupBrowser();
  };

  const callFromBrowser = async () => {
    if (!device || !number.trim()) return;
    setBusy(true);
    try {
      const c = await device.connect({
        params: { To: normalizeToE164(number.trim()) },
      });
      setCall(c);
      setActiveChannel("browser");
      c.on("accept", () => {
        const sid = c.parameters?.CallSid;
        if (sid) setActiveCallSid(sid);
      });
      c.on("disconnect", () => {
        clearActiveSession();
        loadCalls();
      });
      showBanner("ok", "Appel lancé depuis le navigateur.");
    } catch (e) {
      console.error(e);
      showBanner("err", "Échec de l’appel navigateur.");
    } finally {
      setBusy(false);
    }
  };

  const clickToCall = async () => {
    if (!number.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/telephony/click-to-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: normalizeToE164(number.trim()) }),
      });
      const data = await res.json();
      if (!res.ok) {
        showBanner("err", data.error || "Échec click-to-call");
        return;
      }
      if (data.callSid) {
        setActiveCallSid(data.callSid);
        setActiveChannel("mobile");
        showBanner(
          "ok",
          "Twilio t’appelle sur ton mobile. Décroche : le client sera composé ensuite."
        );
      }
    } catch (e) {
      showBanner("err", e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setBusy(false);
    }
  };

  const saveAgentPhone = async () => {
    setAgentSaving(true);
    try {
      const res = await fetch("/api/telephony/agent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_e164: agentPhone }),
      });
      const data = await res.json();
      if (!res.ok) showBanner("err", data.error || "Erreur");
      else {
        if (data.phone_e164) setAgentPhone(data.phone_e164);
        showBanner("ok", "Numéro enregistré.");
      }
    } finally {
      setAgentSaving(false);
    }
  };

  const transferToBoss = async () => {
    if (!activeCallSid) return;
    setBusy(true);
    try {
      const res = await fetch("/api/telephony/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callSid: activeCallSid }),
      });
      const data = await res.json();
      if (!res.ok) showBanner("err", data.error || "Transfert impossible");
      else {
        showBanner("ok", "Transfert lancé vers le responsable.");
        if (activeChannel === "browser") call?.disconnect();
        clearActiveSession();
      }
    } finally {
      setBusy(false);
      loadCalls();
    }
  };

  const active = Boolean(call) || Boolean(activeCallSid && activeChannel === "mobile");
  const canTransfer = Boolean(activeCallSid);

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Téléphonie"
        title="Centre d’appels"
        description={
          <>
            Softphone WebRTC, click-to-call vers ton mobile, enregistrements avec
            transcription (IA), et transfert vers le responsable — le tout depuis une
            seule vue.
          </>
        }
      />

      {banner ? (
        <div
          className={cn(
            "mb-6 rounded-sm border px-4 py-3 text-sm",
            banner.type === "ok"
              ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-900 dark:text-emerald-100"
              : "border-destructive/30 bg-destructive/5 text-destructive"
          )}
          role="status"
        >
          {banner.text}
        </div>
      ) : null}

      {configError ? (
        <Panel padding="md" className="mb-8 rounded-sm border-destructive/30">
          <p className="text-sm text-destructive">{configError}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Vérifie les variables Twilio et{" "}
            <code className="font-mono text-[11px]">docs/TELEPHONY.md</code>.
          </p>
        </Panel>
      ) : null}

      {active ? (
        <div className="mb-8 rounded-sm border border-[color-mix(in_srgb,var(--blue)_35%,transparent)] bg-[color-mix(in_srgb,var(--blue)_6%,transparent)] px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--blue)_18%,transparent)]">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color-mix(in_srgb,var(--blue)_25%,transparent)] opacity-40" />
                {activeChannel === "mobile" ? (
                  <Smartphone className="relative h-5 w-5 text-[var(--blue)]" strokeWidth={1.5} />
                ) : (
                  <Monitor className="relative h-5 w-5 text-[var(--blue)]" strokeWidth={1.5} />
                )}
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {activeChannel === "mobile"
                    ? "Appel en cours (mobile → client)"
                    : "Appel en cours (navigateur)"}
                </p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {activeCallSid ? `${activeCallSid.slice(0, 14)}…` : "—"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !canTransfer}
                onClick={transferToBoss}
                className="btn-solid"
              >
                <PhoneForwarded className="h-4 w-4" strokeWidth={1.25} />
                Transférer au responsable
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={hangup}
                className="btn-outline border-destructive/35 text-destructive hover:bg-destructive/5"
              >
                <PhoneOff className="h-4 w-4" strokeWidth={1.25} />
                Raccrocher
              </button>
            </div>
          </div>
          {activeChannel === "mobile" ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Le transfert et le raccroché utilisent l’identifiant d’appel Twilio — garde
              cette page ouverte pendant la conversation.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          padding="md"
          className="rounded-sm border border-border/80 shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-none"
        >
          <div className="mb-5 flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-muted/80">
              <Headphones className="h-4 w-4 text-muted-foreground" strokeWidth={1.25} />
            </div>
            <div>
              <h3 className="text-sm font-medium tracking-tight text-foreground">
                Ton numéro pour le click-to-call
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Twilio t’appelle sur ce numéro (mobile conseillé). Une fois décroché, le
                numéro client saisi ci-contre est composé automatiquement. Utilise un
                numéro{" "}
                <strong className="font-medium text-foreground/90">vérifié</strong>{" "}
                côté Twilio si besoin.
              </p>
            </div>
          </div>
          <label className="label-eyebrow mb-2 block text-[10px] uppercase tracking-wider">
            Mobile / ligne directe (E.164)
          </label>
          <input
            type="tel"
            value={agentPhone}
            onChange={(e) => setAgentPhone(e.target.value)}
            className="input-minimal mb-3"
            placeholder="+33 6 12 34 56 78"
            autoComplete="tel"
          />
          <button
            type="button"
            onClick={saveAgentPhone}
            disabled={agentSaving}
            className="btn-outline w-full"
          >
            {agentSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Enregistrer mon numéro
          </button>
        </Panel>

        <Panel
          padding="md"
          className="rounded-sm border border-border/80 shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-none"
        >
          <div className="mb-5 flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-muted/80">
              <Mic className="h-4 w-4 text-muted-foreground" strokeWidth={1.25} />
            </div>
            <div>
              <h3 className="text-sm font-medium tracking-tight text-foreground">
                Numéro à joindre
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Saisis le numéro du client (France ou international). Choisis ensuite si
                tu passes par le{" "}
                <strong className="font-medium text-foreground/90">navigateur</strong>{" "}
                (micro) ou ton{" "}
                <strong className="font-medium text-foreground/90">mobile</strong>{" "}
                (click-to-call).
              </p>
            </div>
          </div>
          <label className="label-eyebrow mb-2 block text-[10px] uppercase tracking-wider">
            Client
          </label>
          <input
            type="tel"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            className="input-minimal mb-4 text-base"
            placeholder="+33 …"
            autoComplete="off"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={!ready || busy || !number.trim() || active}
              onClick={callFromBrowser}
              className="btn-solid flex items-center justify-center gap-2"
            >
              {!ready ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PhoneCall className="h-4 w-4" strokeWidth={1.25} />
              )}
              Via navigateur
            </button>
            <button
              type="button"
              disabled={busy || !number.trim() || active}
              onClick={clickToCall}
              className="btn-outline flex items-center justify-center gap-2"
            >
              <Phone className="h-4 w-4" strokeWidth={1.25} />
              Via mon mobile
            </button>
          </div>
        </Panel>
      </div>

      <Panel
        padding="md"
        className="mt-10 rounded-sm border border-border/80 shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-none"
      >
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" strokeWidth={1.25} />
            <h3 className="text-sm font-medium tracking-tight text-foreground">
              Historique & enregistrements
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoadingList(true);
              void loadCalls();
            }}
            disabled={loadingList}
            className="btn-outline inline-flex items-center gap-2 self-start text-xs sm:self-auto"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", loadingList && "animate-spin")}
              strokeWidth={1.25}
            />
            Actualiser
          </button>
        </div>
        <p className="mb-6 text-xs text-muted-foreground">
          Les transcriptions sont générées après la fin de l’appel (quelques secondes à une
          minute). Actualise si besoin.
        </p>
        {loadingList ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun appel enregistré pour l’instant.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-sm border border-border">
            {rows.map((r) => {
              const open = expandedId === r.id;
              const meta = r.metadata as { channel?: string } | null | undefined;
              const channel =
                meta?.channel === "click-to-call"
                  ? "Mobile (click-to-call)"
                  : r.from_number?.includes("client:")
                    ? "Navigateur (WebRTC)"
                    : "Appel";
              return (
                <li key={r.id} className="bg-card/30">
                  <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {new Date(r.created_at).toLocaleString("fr-FR")}
                      </p>
                      <p className="truncate text-sm text-foreground">
                        <span className="text-muted-foreground">{channel}</span>
                        {" · "}
                        {r.from_number ?? "?"} → {r.to_number ?? "?"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.status ?? "—"}
                        {r.recording_duration_sec != null
                          ? ` · ${r.recording_duration_sec}s`
                          : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                      {r.recording_url ? (
                        <audio
                          controls
                          className="h-8 w-full max-w-[min(100%,280px)]"
                          src={`/api/telephony/recording-proxy?url=${encodeURIComponent(r.recording_url)}`}
                          preload="metadata"
                        >
                          <track kind="captions" />
                        </audio>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Pas d’audio
                        </span>
                      )}
                    </div>
                  </div>
                  {r.transcription?.trim() ? (
                    <div className="border-t border-border/80 px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setExpandedId(open ? null : r.id)}
                        className="flex w-full items-center gap-2 text-left text-xs font-medium text-[var(--blue)]"
                      >
                        Transcription
                        {open ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>
                      {open ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                          {r.transcription}
                        </p>
                      ) : (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {r.transcription}
                        </p>
                      )}
                    </div>
                  ) : r.recording_url ? (
                    <div className="border-t border-border/80 px-4 py-2.5">
                      <p className="text-xs text-muted-foreground">
                        Transcription en cours d’analyse…
                      </p>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
