"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Bot,
  Send,
  Loader2,
  Brain,
  Users,
  TableProperties,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Mission {
  id: string;
  status: string;
  user_prompt: string;
  cost_cents: number;
  leads_found: number;
  created_at: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "thinking" | "system" | "plan" | "error";
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

type SideTab = "thinking" | "agents" | "leads";

export default function LeadAgentPage() {
  const { user } = useAuth();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [activeMission, setActiveMission] = useState<Mission | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sideTab, setSideTab] = useState<SideTab>("thinking");
  const [sideOpen, setSideOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const fetchMissions = useCallback(async () => {
    const res = await fetch("/api/lead-agent/missions");
    if (!res.ok) return;
    const { missions: m } = await res.json();
    setMissions(m || []);
  }, []);

  const fetchMessages = useCallback(async (missionId: string) => {
    const res = await fetch(`/api/lead-agent/messages?missionId=${missionId}`);
    if (!res.ok) return;
    const { messages: msgs } = await res.json();
    setMessages(msgs || []);
  }, []);

  useEffect(() => {
    fetchMissions();
  }, [fetchMissions]);

  useEffect(() => {
    if (!activeMission) return;
    fetchMessages(activeMission.id);

    const interval = setInterval(() => {
      fetchMessages(activeMission.id);
      fetchMissions();
    }, 3000);

    return () => clearInterval(interval);
  }, [activeMission, fetchMessages, fetchMissions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");

    try {
      if (activeMission) {
        await fetch("/api/lead-agent/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ missionId: activeMission.id, content: text }),
        });
        await fetchMessages(activeMission.id);
      } else {
        const res = await fetch("/api/lead-agent/missions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text }),
        });
        if (res.ok) {
          const { mission } = await res.json();
          setActiveMission(mission);
          await fetchMissions();
        }
      }
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const thinkingMessages = messages.filter((m) => m.role === "thinking");
  const systemMessages = messages.filter((m) => m.role === "system");
  const chatMessages = messages.filter((m) =>
    ["user", "assistant", "plan", "error"].includes(m.role)
  );

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-0 lg:h-[calc(100vh-5rem)]">
      {/* ── Chat Panel ──────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-blue-500" strokeWidth={1.5} />
            <h1 className="text-sm font-semibold">Lead Agent</h1>
            <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-blue-500">
              Beta
            </span>
          </div>
          <div className="flex items-center gap-1">
            {activeMission && (
              <span className="text-xs text-muted-foreground">
                {activeMission.leads_found} leads &middot;{" "}
                {((activeMission.cost_cents || 0) / 100).toFixed(2)}€
              </span>
            )}
            <button
              onClick={() => setSideOpen(!sideOpen)}
              className="ml-2 rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
            >
              <ChevronRight className={cn("h-4 w-4 transition-transform", sideOpen && "rotate-180")} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {chatMessages.length === 0 && !activeMission && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Bot className="mb-4 h-12 w-12 text-muted-foreground/30" strokeWidth={1} />
              <p className="mb-1 text-sm font-medium text-foreground">
                Lead Agent
              </p>
              <p className="max-w-md text-xs text-muted-foreground">
                Describe what you&apos;re looking for. For example:
                &ldquo;Trouve-moi 50 pizzerias a Lyon&rdquo; or
                &ldquo;Je vends un service de creation de site web a 1500€ pour les artisans&rdquo;
              </p>
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
                    : "bg-muted text-foreground"
              )}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>
              {msg.metadata &&
                Array.isArray((msg.metadata as Record<string, unknown>).options) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {((msg.metadata as Record<string, unknown>).options as string[]).map(
                      (opt) => (
                        <button
                          key={opt}
                          onClick={() => {
                            setInput(opt);
                            handleSend();
                          }}
                          className="rounded border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
                        >
                          {opt}
                        </button>
                      )
                    )}
                  </div>
                )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
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
                activeMission
                  ? "Répondre à l'agent..."
                  : "Décrivez votre recherche de leads..."
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
          "flex w-80 shrink-0 flex-col border-l border-border bg-card transition-all",
          sideOpen ? "translate-x-0" : "hidden lg:flex"
        )}
      >
        {/* Tabs */}
        <div className="flex border-b border-border">
          {([
            { key: "thinking", icon: Brain, label: "Thinking" },
            { key: "agents", icon: Users, label: "Agents" },
            { key: "leads", icon: TableProperties, label: "Leads" },
          ] as const).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setSideTab(key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium transition-colors",
                sideTab === key
                  ? "border-b-2 border-blue-500 text-blue-500"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
              {label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {sideTab === "thinking" && (
            <div className="space-y-2">
              {thinkingMessages.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground">
                  Agent thinking will appear here...
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

          {sideTab === "agents" && (
            <div className="space-y-2">
              {systemMessages.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground">
                  Sub-agent activity will appear here...
                </p>
              ) : (
                systemMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className="flex items-start gap-2 rounded border border-border p-2 text-[11px]"
                  >
                    <div className="h-1.5 w-1.5 mt-1 shrink-0 rounded-full bg-green-500" />
                    <span className="text-muted-foreground">{msg.content}</span>
                  </div>
                ))
              )}
            </div>
          )}

          {sideTab === "leads" && (
            <p className="text-center text-xs text-muted-foreground">
              Leads will appear here as the agent discovers them...
            </p>
          )}
        </div>

        {/* Mission List */}
        {missions.length > 0 && (
          <div className="border-t border-border p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Recent Missions
            </p>
            <div className="space-y-1">
              {missions.slice(0, 5).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setActiveMission(m)}
                  className={cn(
                    "w-full rounded px-2 py-1.5 text-left text-[11px] transition-colors",
                    activeMission?.id === m.id
                      ? "bg-blue-500/10 text-blue-500"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  <span className="line-clamp-1">
                    {m.user_prompt.slice(0, 60)}
                  </span>
                  <span className="text-[9px] opacity-60">
                    {m.status} &middot; {m.leads_found} leads
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
