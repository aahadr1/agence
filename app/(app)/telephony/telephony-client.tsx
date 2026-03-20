"use client";

import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { normalizeToE164 } from "@/lib/telephony/phone";
import { Device, type Call } from "@twilio/voice-sdk";
import {
  Loader2,
  Mic,
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneOff,
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
  created_at: string;
};

export function TelephonyClient() {
  const [ready, setReady] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [call, setCall] = useState<Call | null>(null);
  const [activeCallSid, setActiveCallSid] = useState<string | null>(null);
  const [number, setNumber] = useState("");
  const [agentPhone, setAgentPhone] = useState("");
  const [agentSaving, setAgentSaving] = useState(false);
  const [rows, setRows] = useState<CallRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [busy, setBusy] = useState(false);
  const deviceRef = useRef<Device | null>(null);

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

  const hangup = () => {
    call?.disconnect();
    setCall(null);
    setActiveCallSid(null);
  };

  const callFromBrowser = async () => {
    if (!device || !number.trim()) return;
    setBusy(true);
    try {
      const c = await device.connect({
        params: { To: normalizeToE164(number.trim()) },
      });
      setCall(c);
      c.on("accept", () => {
        const sid = c.parameters?.CallSid;
        if (sid) setActiveCallSid(sid);
      });
      c.on("disconnect", () => {
        setCall(null);
        setActiveCallSid(null);
        loadCalls();
      });
    } catch (e) {
      console.error(e);
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
        alert(data.error || "Échec click-to-call");
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erreur réseau");
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
      if (!res.ok) alert(data.error || "Erreur");
      else if (data.phone_e164) setAgentPhone(data.phone_e164);
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
      if (!res.ok) alert(data.error || "Transfert impossible");
      else hangup();
    } finally {
      setBusy(false);
      loadCalls();
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Téléphonie"
        title="Appels Twilio"
        description="Softphone navigateur (WebRTC), click-to-call vers votre mobile, enregistrements et transfert vers le responsable. 2–5 comptes : chacun enregistre son numéro pour les appels depuis le fixe/mobile."
      />

      {configError ? (
        <Panel padding="md" className="mb-8 rounded-sm border-destructive/30">
          <p className="text-sm text-destructive">{configError}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Vérifiez les variables Twilio et consultez{" "}
            <code className="font-mono text-[11px]">docs/TELEPHONY.md</code>.
          </p>
        </Panel>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-2">
        <Panel padding="md" className="rounded-sm">
          <h3 className="label-eyebrow mb-4 flex items-center gap-2">
            <Mic className="h-3.5 w-3.5" strokeWidth={1.25} />
            Votre numéro (click-to-call)
          </h3>
          <p className="mb-4 text-xs text-muted-foreground">
            Twilio vous appelle sur ce numéro ; une fois décroché, le client est
            composé automatiquement.
          </p>
          <input
            type="tel"
            value={agentPhone}
            onChange={(e) => setAgentPhone(e.target.value)}
            className="input-minimal mb-3"
            placeholder="+33 6 12 34 56 78"
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
            Enregistrer
          </button>
        </Panel>

        <Panel padding="md" className="rounded-sm">
          <h3 className="label-eyebrow mb-4 flex items-center gap-2">
            <Phone className="h-3.5 w-3.5" strokeWidth={1.25} />
            Composer
          </h3>
          <input
            type="tel"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            className="input-minimal mb-4"
            placeholder="Numéro client (France ou international)"
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              disabled={!ready || busy || !number.trim()}
              onClick={callFromBrowser}
              className="btn-solid flex-1"
            >
              {!ready ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PhoneCall className="h-4 w-4" strokeWidth={1.25} />
              )}
              Navigateur
            </button>
            <button
              type="button"
              disabled={busy || !number.trim()}
              onClick={clickToCall}
              className="btn-outline flex-1"
            >
              <PhoneForwarded className="h-4 w-4" strokeWidth={1.25} />
              Mon mobile
            </button>
            {call ? (
              <button
                type="button"
                onClick={hangup}
                className="btn-outline border-destructive/40 text-destructive"
              >
                <PhoneOff className="h-4 w-4" strokeWidth={1.25} />
                Raccrocher
              </button>
            ) : null}
          </div>
          {activeCallSid ? (
            <button
              type="button"
              disabled={busy}
              onClick={transferToBoss}
              className="btn-solid mt-4 w-full"
            >
              Transférer au responsable
            </button>
          ) : null}
        </Panel>
      </div>

      <Panel padding="md" className="mt-10 rounded-sm">
        <h3 className="label-eyebrow mb-4">Enregistrements récents</h3>
        {loadingList ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun appel enregistré pour l’instant.
          </p>
        ) : (
          <ul className="divide-y divide-border border border-border">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 text-sm">
                  <p className="font-mono text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("fr-FR")}
                  </p>
                  <p className="truncate text-foreground">
                    {r.from_number ?? "?"} → {r.to_number ?? "?"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.status ?? "—"}
                    {r.recording_duration_sec != null
                      ? ` · ${r.recording_duration_sec}s`
                      : ""}
                  </p>
                </div>
                {r.recording_url ? (
                  <audio
                    controls
                    className="h-8 w-full max-w-xs"
                    src={r.recording_url}
                  >
                    <track kind="captions" />
                  </audio>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Pas d’enregistrement
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
