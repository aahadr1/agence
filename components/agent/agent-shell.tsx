"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowDownCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

import type {
  Approval,
  CapabilityPreset,
  Message,
  Reflection,
  Session,
  Todo,
} from "./types";
import { buildTimeline } from "./timeline";

import { SessionsRail } from "./sessions-rail";
import { AgentHeader } from "./header";
import { TodoTracker } from "./todo-tracker";
import { StreamEvent } from "./stream-event";
import { StatusIndicator } from "./status-indicator";
import { EmptyState } from "./empty-state";
import { Composer, type ComposerHandle } from "./composer";
import { BrowserCredentialsPanel } from "./browser-credentials-panel";
import { OsContextPanel } from "./os-context-panel";

const CAPABILITY_PRESETS: CapabilityPreset[] = [
  {
    id: "lead-gen",
    label: "Lead Gen FR",
    packs: ["lead-gen-fr", "browser", "web-research"],
    description:
      "Prospection B2B France (Pappers, GMB, Societe.com, save_lead) + navigateur Playwright + images Replicate (Nano Banana / 2 / Pro)",
  },
  {
    id: "assistant",
    label: "Assistant général",
    packs: ["browser", "web-research"],
    description:
      "Recherche web + navigateur Playwright + images Replicate (Nano Banana par défaut)",
  },
  {
    id: "email-ops",
    label: "Email & agenda",
    packs: ["email", "calendar", "web-research"],
    description: "Gmail + Calendar connectés",
  },
  {
    id: "autonomous",
    label: "Navigateur autonome",
    packs: ["browser", "web-research"],
    description: "Tout + navigateur headless",
  },
  {
    id: "self-coding",
    label: "Self-coding",
    packs: ["self-coding", "web-research"],
    description: "L'agent peut ouvrir des PR GitHub pour s'étendre",
  },
  {
    id: "agent-os",
    label: "Agent OS",
    packs: ["agent-os", "browser", "web-research", "self-coding"],
    description:
      "Superviseur + façades navigateur/recherche, workspace lecture, mémoire sources/artefacts, audit outils, MCP/workflow (stubs)",
  },
];

const SUGGESTIONS: Record<string, string[]> = {
  assistant: [
    "Résume les dernières publications sur l'IA générative cette semaine.",
    "Explique-moi comment configurer un Agent autonome en production.",
  ],
  "lead-gen": [
    "Trouve-moi 10 restaurants à Nancy avec leur dirigeant et un contact.",
    "Liste 20 cabinets d'avocats en droit du travail à Lyon avec email.",
  ],
  "email-ops": [
    "Planifie un rendez-vous mardi matin avec Paul et envoie-lui une confirmation.",
    "Rédige un email de relance pour mes prospects restés silencieux.",
  ],
  autonomous: [
    "Ouvre societe.com, trouve la fiche d'Apple France et extrais les infos clefs.",
    "Navigue sur LinkedIn et prépare une liste de 10 CTO fintech à Paris.",
  ],
  "self-coding": [
    "Crée un nouvel outil `slugify` qui transforme un texte en slug URL-safe.",
    "Ajoute un outil `currency_convert` qui utilise une API publique de taux de change.",
  ],
  "agent-os": [
    "Recherche synthétique sur X, cite 5 sources, enregistre-les et produis un rapport JSON puis markdown.",
    "Liste les fichiers sous lib/agent, lis engine.ts et résume le flux d’exécution des outils.",
  ],
};

export function AgentShell() {
  const supabase = useMemo(() => createClient(), []);
  const composerRef = useRef<ComposerHandle>(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [preset, setPreset] = useState<CapabilityPreset>(CAPABILITY_PRESETS[0]);
  const [railOpen, setRailOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const stickToBottom = useRef(true);
  const [stoppingAgent, setStoppingAgent] = useState(false);

  // -------------------------- Data fetching --------------------------

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/sessions");
      const json = await res.json().catch(() => ({}));
      setSessions(json.sessions || []);
    } catch {
      /* noop */
    }
  }, []);

  const fetchSession = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/agent/sessions/${id}`);
      const json = await res.json().catch(() => ({}));
      setMessages(json.messages || []);
      setTodos(json.todos || []);
      setReflections(json.reflections || []);
      setApprovals(json.approvals || []);
      if (json.session) setActive(json.session);
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Realtime
  useEffect(() => {
    if (!active) return;
    fetchSession(active.id);

    const channel = supabase
      .channel(`agent-session-${active.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_messages",
          filter: `session_id=eq.${active.id}`,
        },
        () => fetchSession(active.id),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_todos",
          filter: `session_id=eq.${active.id}`,
        },
        () => fetchSession(active.id),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_reflections",
          filter: `session_id=eq.${active.id}`,
        },
        () => fetchSession(active.id),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_approvals",
          filter: `session_id=eq.${active.id}`,
        },
        () => fetchSession(active.id),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "agent_sessions",
          filter: `id=eq.${active.id}`,
        },
        () => {
          fetchSession(active.id);
          fetchSessions();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [active, fetchSession, fetchSessions, supabase]);

  // -------------------------- Scroll tracking --------------------------

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 80;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distanceFromBottom < threshold;
    stickToBottom.current = near;
    setShowJumpToBottom(!near);
  }, []);

  useEffect(() => {
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, reflections, approvals, todos]);

  const jumpToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // -------------------------- Actions --------------------------

  const handleSend = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || sending) return;
    setSending(true);
    if (override === undefined) setInput("");
    try {
      if (active) {
        await fetch(`/api/agent/sessions/${active.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text }),
        });
        await fetchSession(active.id);
      } else {
        const res = await fetch("/api/agent/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: text,
            capabilityPacks: preset.packs,
            model: "gemini-2.5-pro",
          }),
        });
        if (res.ok) {
          const { session } = await res.json();
          setActive(session);
          await fetchSessions();
        }
      }
    } finally {
      setSending(false);
      composerRef.current?.focus();
    }
  };

  const respondApproval = async (
    approvalId: string,
    decision: "approve" | "reject",
  ) => {
    if (!active) return;
    await fetch(
      `/api/agent/sessions/${active.id}/approvals/${approvalId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    );
    await fetchSession(active.id);
  };

  const startNew = () => {
    setActive(null);
    setMessages([]);
    setTodos([]);
    setReflections([]);
    setApprovals([]);
    setInput("");
    setTimeout(() => composerRef.current?.focus(), 30);
  };

  // -------------------------- Derived --------------------------

  const timeline = useMemo(
    () => buildTimeline(messages, reflections),
    [messages, reflections],
  );

  const isLive =
    active?.status === "running" ||
    active?.status === "pending" ||
    active?.status === "awaiting_approval";

  const canStopAgent = Boolean(
    active &&
      ["running", "pending", "planning", "paused", "awaiting_approval"].includes(
        active.status,
      ),
  );

  const handleStopAgent = useCallback(async () => {
    if (!active || stoppingAgent) return;
    setStoppingAgent(true);
    try {
      const res = await fetch(`/api/agent/sessions/${active.id}/cancel`, {
        method: "POST",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        console.warn("[agent] cancel failed:", j.error || res.statusText);
      }
      await fetchSession(active.id);
      await fetchSessions();
    } finally {
      setStoppingAgent(false);
    }
  }, [active, stoppingAgent, fetchSession, fetchSessions]);

  // Keyword-based preset hint: when the user is about to start a NEW
  // session and their prompt obviously asks for lead generation but the
  // currently-selected preset has no lead-gen tools, surface a gentle
  // nudge. Without this, the agent silently falls back to web_search
  // and hallucinates Pappers / Societe.com results (Nancy incident).
  const presetMismatchWarning = useMemo(() => {
    if (active) return null; // only when creating a new session
    if (!input.trim()) return null;
    const hasLeadGen = preset.packs.includes("lead-gen-fr");
    if (hasLeadGen) return null;
    const LEAD_KEYWORDS =
      /\b(lead|leads|prospect|prospects|prospection|cold\s*(call|email)|b2b|restaurant|restaurants|cabinet|cabinets|entreprise|entreprises|dirigeant|dirigeants|pappers|societe\.?com|gmb|google\s*my\s*business|siren|siret)\b/i;
    return LEAD_KEYWORDS.test(input) ? true : null;
  }, [active, input, preset]);

  return (
    <div
      className={cn(
        "flex h-[calc(100vh-7rem)] lg:h-[calc(100vh-5rem)]",
        "overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]",
      )}
    >
      <SessionsRail
        sessions={sessions}
        activeId={active?.id || null}
        onSelect={(s) => {
          setActive(s);
          setRailOpen(false);
        }}
        onNew={startNew}
      />

      {/* Mobile slide-in rail */}
      {railOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          onClick={() => setRailOpen(false)}
        >
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute inset-y-0 left-0 w-[280px] bg-[var(--card)] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <SessionsRail
              sessions={sessions}
              activeId={active?.id || null}
              onSelect={(s) => {
                setActive(s);
                setRailOpen(false);
              }}
              onNew={() => {
                startNew();
                setRailOpen(false);
              }}
            />
          </div>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col bg-[var(--background)]">
        <AgentHeader
          session={active}
          onToggleRail={() => setRailOpen((o) => !o)}
          canStopAgent={canStopAgent}
          onStopAgent={() => void handleStopAgent()}
          stoppingAgent={stoppingAgent}
        />

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="relative flex-1 overflow-y-auto"
        >
            {active && (
              <BrowserCredentialsPanel
                sessionId={active.id}
                orgId={active.org_id}
              />
            )}
            {active && todos.length > 0 && <TodoTracker todos={todos} />}
            {active && (
              <OsContextPanel
                sessionId={active.id}
                enabled={Boolean(
                  active.capability_packs?.includes("agent-os"),
                )}
              />
            )}

          <div className="mx-auto w-full max-w-3xl px-4 py-5 lg:px-6">
            {!active && timeline.length === 0 && (
              <EmptyState
                presets={CAPABILITY_PRESETS}
                selected={preset}
                onSelect={setPreset}
                suggestions={SUGGESTIONS[preset.id] || []}
                onSuggestion={(s) => handleSend(s)}
              />
            )}

            {timeline.length > 0 && (
              <div className="space-y-5">
                {timeline.map((ev, i) => (
                  <StreamEvent
                    key={ev.id}
                    event={ev}
                    approvals={approvals}
                    onRespondApproval={respondApproval}
                    last={i === timeline.length - 1}
                  />
                ))}
                {isLive && <StatusIndicator status={active!.status} />}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {showJumpToBottom && (
            <button
              onClick={jumpToBottom}
              className={cn(
                "absolute bottom-4 left-1/2 -translate-x-1/2",
                "inline-flex items-center gap-1.5 rounded-full border border-[var(--border)]",
                "bg-[var(--card)] px-3 py-1 text-[11.5px] shadow-sm",
                "hover:bg-[var(--muted)]",
              )}
            >
              <ArrowDownCircle className="h-3.5 w-3.5" />
              Revenir en bas
            </button>
          )}
        </div>

        {presetMismatchWarning && (
          <div className="border-t border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[12px] text-amber-700 dark:text-amber-300">
            <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
              <span>
                Votre demande ressemble à de la prospection mais le preset actif
                est <strong>{preset.label}</strong> (sans outils lead-gen).
              </span>
              <button
                type="button"
                onClick={() => {
                  const leadPreset = CAPABILITY_PRESETS.find(
                    (p) => p.id === "lead-gen",
                  );
                  if (leadPreset) setPreset(leadPreset);
                }}
                className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium hover:bg-amber-500/20"
              >
                Passer à Lead Gen FR
              </button>
            </div>
          </div>
        )}

        <Composer
          ref={composerRef}
          value={input}
          onChange={setInput}
          onSend={() => handleSend()}
          sending={sending}
          placeholder={
            active
              ? "Répondez à l'agent…"
              : `Décrivez votre tâche (${preset.label})…`
          }
        />
      </main>
    </div>
  );
}
