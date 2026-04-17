"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Bot,
  Send,
  Loader2,
  Brain,
  ListTodo,
  ShieldAlert,
  Sparkles,
  ChevronRight,
  CheckCircle2,
  Circle,
  XCircle,
  PlayCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

interface Session {
  id: string;
  title: string | null;
  status: string;
  model: string;
  cost_cents: number;
  capability_packs: string[];
  created_at: string;
}

interface Message {
  id: string;
  role:
    | "user"
    | "assistant"
    | "thinking"
    | "system"
    | "plan"
    | "error"
    | "approval_request"
    | "approval_response";
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

interface Todo {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  position: number;
}

interface Reflection {
  id: string;
  iteration: number;
  observation: string;
  conclusion: string;
  next_action: string | null;
  created_at: string;
}

interface Approval {
  id: string;
  action: string;
  details: string;
  risk: "low" | "medium" | "high";
  status: "awaiting" | "approved" | "rejected" | "expired";
  created_at: string;
}

type SideTab = "todo" | "thinking" | "reflect" | "approvals";

const CAPABILITY_PRESETS: Array<{
  id: string;
  label: string;
  packs: string[];
  description: string;
}> = [
  {
    id: "assistant",
    label: "Assistant général",
    packs: ["web-research"],
    description: "Recherche web + tâches générales",
  },
  {
    id: "lead-gen",
    label: "Lead Gen FR",
    packs: ["lead-gen-fr", "web-research"],
    description: "Prospection B2B en France",
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
];

export default function AgentPage() {
  useAuth();
  const supabase = createClient();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [preset, setPreset] = useState(CAPABILITY_PRESETS[0]);
  const [sideTab, setSideTab] = useState<SideTab>("todo");
  const [sideOpen, setSideOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/sessions");
      const json = await res.json().catch(() => ({}));
      setSessions(json.sessions || []);
    } catch {
      /* */
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
      /* */
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Realtime subscriptions for active session
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
        () => fetchSessions(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [active, fetchSession, fetchSessions, supabase]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
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
      inputRef.current?.focus();
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

  const chatMessages = messages.filter((m) =>
    ["user", "assistant", "plan", "error", "approval_request", "approval_response"].includes(
      m.role,
    ),
  );
  const thinkingMessages = messages.filter((m) => m.role === "thinking");
  const pendingApprovals = approvals.filter((a) => a.status === "awaiting");

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-0 lg:h-[calc(100vh-5rem)]">
      {/* ── Chat Panel ──────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-blue-500" strokeWidth={1.5} />
            <h1 className="text-sm font-semibold">Agent</h1>
            <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-blue-500">
              v3
            </span>
            {active && (
              <span className="ml-2 rounded bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                {active.status}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {active && (
              <span className="text-xs text-muted-foreground">
                {((active.cost_cents || 0) / 100).toFixed(2)}€
              </span>
            )}
            <button
              onClick={() => setSideOpen(!sideOpen)}
              className="ml-2 rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
            >
              <ChevronRight
                className={cn(
                  "h-4 w-4 transition-transform",
                  sideOpen && "rotate-180",
                )}
              />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {chatMessages.length === 0 && !active && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Bot
                className="mb-4 h-12 w-12 text-muted-foreground/30"
                strokeWidth={1}
              />
              <p className="mb-1 text-sm font-medium text-foreground">
                Agent autonome
              </p>
              <p className="mb-4 max-w-md text-xs text-muted-foreground">
                Choisis un mode et décris ta tâche. L&apos;agent planifie,
                réfléchit, utilise des outils, et te demande ton aval avant toute
                action sensible.
              </p>
              <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
                {CAPABILITY_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPreset(p)}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors",
                      preset.id === p.id
                        ? "border-blue-500 bg-blue-500/5"
                        : "border-border hover:bg-muted",
                    )}
                  >
                    <p className="text-[12px] font-semibold text-foreground">
                      {p.label}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {p.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "mb-3 max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed",
                msg.role === "user"
                  ? "ml-auto bg-blue-500 text-white"
                  : msg.role === "error"
                    ? "bg-red-500/10 text-red-600"
                    : msg.role === "approval_request"
                      ? "border border-amber-500/50 bg-amber-500/5"
                      : msg.role === "approval_response"
                        ? "border border-green-500/30 bg-green-500/5 text-green-700"
                        : "bg-muted text-foreground",
              )}
            >
              {msg.role === "approval_request" &&
              msg.metadata?.approval_id ? (
                <ApprovalCard
                  messageContent={msg.content}
                  metadata={msg.metadata}
                  onRespond={respondApproval}
                  approvals={approvals}
                />
              ) : (
                <div className="whitespace-pre-wrap">{msg.content}</div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                active
                  ? "Répondre à l'agent..."
                  : `Décrivez votre tâche (mode : ${preset.label})...`
              }
              rows={1}
              className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500 text-white transition-colors hover:bg-blue-600 disabled:opacity-40"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Side Panel ──────────────────────────────────────────── */}
      <div
        className={cn(
          "flex w-96 shrink-0 flex-col border-l border-border bg-card transition-all",
          sideOpen ? "translate-x-0" : "hidden lg:flex",
        )}
      >
        <div className="flex border-b border-border">
          {(
            [
              {
                key: "todo",
                icon: ListTodo,
                label: "Todo",
                badge: todos.filter((t) => t.status === "in_progress").length,
              },
              { key: "thinking", icon: Brain, label: "Thinking", badge: 0 },
              {
                key: "reflect",
                icon: Sparkles,
                label: "Reflect",
                badge: reflections.length,
              },
              {
                key: "approvals",
                icon: ShieldAlert,
                label: "Approve",
                badge: pendingApprovals.length,
              },
            ] as const
          ).map(({ key, icon: Icon, label, badge }) => (
            <button
              key={key}
              onClick={() => setSideTab(key)}
              className={cn(
                "relative flex flex-1 items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                sideTab === key
                  ? "border-b-2 border-blue-500 text-blue-500"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
              {label}
              {badge > 0 && (
                <span className="ml-0.5 rounded-full bg-blue-500 px-1 text-[9px] font-bold text-white">
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {sideTab === "todo" && (
            <div className="space-y-1.5">
              {todos.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground">
                  L&apos;agent n&apos;a pas encore créé de todo.
                </p>
              ) : (
                todos.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-start gap-2 rounded border border-border p-2 text-[12px]"
                  >
                    {t.status === "completed" ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
                    ) : t.status === "in_progress" ? (
                      <PlayCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-pulse text-blue-500" />
                    ) : t.status === "cancelled" ? (
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span
                      className={cn(
                        "flex-1",
                        t.status === "completed" &&
                          "text-muted-foreground line-through",
                        t.status === "cancelled" && "text-muted-foreground",
                      )}
                    >
                      {t.content}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {sideTab === "thinking" && (
            <div className="space-y-2">
              {thinkingMessages.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground">
                  Les pensées de l&apos;agent apparaîtront ici...
                </p>
              ) : (
                thinkingMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className="rounded border border-border bg-muted/50 p-2 text-[11px] leading-relaxed text-muted-foreground"
                  >
                    {msg.content}
                  </div>
                ))
              )}
            </div>
          )}

          {sideTab === "reflect" && (
            <div className="space-y-2">
              {reflections.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground">
                  Aucune auto-réflexion pour l&apos;instant.
                </p>
              ) : (
                reflections.map((r) => (
                  <div
                    key={r.id}
                    className="space-y-1 rounded border border-border p-2 text-[11px]"
                  >
                    <p className="font-semibold text-foreground">
                      Iter #{r.iteration}
                    </p>
                    {r.observation && (
                      <p>
                        <span className="text-muted-foreground">Observ. :</span>{" "}
                        {r.observation}
                      </p>
                    )}
                    <p>
                      <span className="text-muted-foreground">Conclusion :</span>{" "}
                      {r.conclusion}
                    </p>
                    {r.next_action && (
                      <p className="text-blue-600">
                        → {r.next_action}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {sideTab === "approvals" && (
            <div className="space-y-2">
              {approvals.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground">
                  Aucune action en attente.
                </p>
              ) : (
                approvals.map((a) => (
                  <div
                    key={a.id}
                    className={cn(
                      "space-y-1.5 rounded border p-2 text-[11px]",
                      a.status === "awaiting"
                        ? "border-amber-500/50 bg-amber-500/5"
                        : "border-border",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-foreground">{a.action}</p>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider",
                          a.risk === "high"
                            ? "bg-red-500/10 text-red-600"
                            : a.risk === "medium"
                              ? "bg-amber-500/10 text-amber-600"
                              : "bg-green-500/10 text-green-600",
                        )}
                      >
                        {a.risk}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-muted-foreground">
                      {a.details}
                    </p>
                    {a.status === "awaiting" ? (
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => respondApproval(a.id, "approve")}
                          className="flex-1 rounded bg-green-500 px-2 py-1 text-[10px] font-semibold text-white hover:bg-green-600"
                        >
                          Approuver
                        </button>
                        <button
                          onClick={() => respondApproval(a.id, "reject")}
                          className="flex-1 rounded bg-red-500 px-2 py-1 text-[10px] font-semibold text-white hover:bg-red-600"
                        >
                          Rejeter
                        </button>
                      </div>
                    ) : (
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {a.status}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {sessions.length > 0 && (
          <div className="border-t border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Sessions récentes
              </p>
              <button
                onClick={() => {
                  setActive(null);
                  setMessages([]);
                  setTodos([]);
                  setReflections([]);
                  setApprovals([]);
                }}
                className="text-[10px] text-blue-500 hover:underline"
              >
                + Nouvelle
              </button>
            </div>
            <div className="space-y-1">
              {sessions.slice(0, 8).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActive(s)}
                  className={cn(
                    "w-full rounded px-2 py-1.5 text-left text-[11px] transition-colors",
                    active?.id === s.id
                      ? "bg-blue-500/10 text-blue-500"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <span className="line-clamp-1">
                    {s.title || "(sans titre)"}
                  </span>
                  <span className="text-[9px] opacity-60">
                    {s.status} &middot; {s.capability_packs?.join(", ") || "—"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ApprovalCard({
  messageContent,
  metadata,
  approvals,
  onRespond,
}: {
  messageContent: string;
  metadata: Record<string, unknown>;
  approvals: Approval[];
  onRespond: (id: string, decision: "approve" | "reject") => void;
}) {
  const approvalId = metadata.approval_id as string | undefined;
  const details = metadata.details as string | undefined;
  const risk = metadata.risk as string | undefined;
  const match = approvals.find((a) => a.id === approvalId);
  const status = match?.status || "awaiting";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-amber-500" />
        <span className="font-semibold">Action à valider</span>
        {risk && (
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-600">
            {risk}
          </span>
        )}
      </div>
      <p className="text-[12px] font-medium">{messageContent}</p>
      {details && (
        <pre className="whitespace-pre-wrap rounded border border-amber-500/30 bg-background p-2 text-[11px]">
          {details}
        </pre>
      )}
      {status === "awaiting" && approvalId && (
        <div className="flex gap-2">
          <button
            onClick={() => onRespond(approvalId, "approve")}
            className="flex-1 rounded bg-green-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-green-600"
          >
            Approuver
          </button>
          <button
            onClick={() => onRespond(approvalId, "reject")}
            className="flex-1 rounded bg-red-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-red-600"
          >
            Rejeter
          </button>
        </div>
      )}
      {status !== "awaiting" && (
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {status}
        </p>
      )}
    </div>
  );
}
