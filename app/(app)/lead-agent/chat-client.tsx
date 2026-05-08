"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Panel } from "@/components/ui/panel";
import { Plus, Send, RotateCcw, Loader2 } from "lucide-react";

interface AgentChat {
  id: string;
  opencode_session_id: string;
  title: string | null;
  created_at: string;
  last_message_at: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolCalls?: Array<{ name: string; status: "running" | "done" | "error" }>;
}

export function ChatClient({
  initialChats,
  userEmail,
}: {
  initialChats: AgentChat[];
  userEmail: string;
}) {
  const [chats, setChats] = useState<AgentChat[]>(initialChats);
  const [activeChatId, setActiveChatId] = useState<string | null>(
    initialChats[0]?.id ?? null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [historyLoadId, setHistoryLoadId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const loadingHistory = historyLoadId !== null;

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Load history when active chat changes
  useEffect(() => {
    if (!activeChatId) return;
    const reqId = activeChatId;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setHistoryLoadId(reqId);
    });
    fetch(`/api/lead-agent/${reqId}/messages`)
      .then((r) => r.json())
      .then((data: { messages?: ChatMessage[] }) => {
        if (!cancelled) setMessages(data.messages ?? []);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoadId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeChatId]);

  const newChat = useCallback(async () => {
    const res = await fetch("/api/lead-agent", { method: "POST" });
    if (!res.ok) return;
    const data = (await res.json()) as { chat: AgentChat };
    setChats((c) => [data.chat, ...c]);
    setActiveChatId(data.chat.id);
    setMessages([]);
  }, []);

  const send = useCallback(async () => {
    if (!input.trim() || streaming) return;
    let chatId = activeChatId;
    if (!chatId) {
      const res = await fetch("/api/lead-agent", { method: "POST" });
      if (!res.ok) return;
      const data = (await res.json()) as { chat: AgentChat };
      setChats((c) => [data.chat, ...c]);
      chatId = data.chat.id;
      setActiveChatId(chatId);
    }

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text: input,
    };
    const placeholderId = `a-${Date.now()}`;
    const placeholder: ChatMessage = {
      id: placeholderId,
      role: "assistant",
      text: "",
      toolCalls: [],
    };
    setMessages((m) => [...m, userMsg, placeholder]);
    const prompt = input;
    setInput("");
    setStreaming(true);

    // Open SSE stream first so we don't miss tokens
    const es = new EventSource(`/api/lead-agent/${chatId}/stream`);
    eventSourceRef.current = es;

    es.addEventListener("text", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as { text: string };
      setMessages((m) =>
        m.map((msg) =>
          msg.id === placeholderId ? { ...msg, text: data.text } : msg,
        ),
      );
    });
    es.addEventListener("tool", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as {
        name: string;
        status: "running" | "done" | "error";
      };
      setMessages((m) =>
        m.map((msg) => {
          if (msg.id !== placeholderId) return msg;
          const calls = msg.toolCalls ?? [];
          const idx = calls.findIndex((c) => c.name === data.name);
          if (idx >= 0) {
            const next = [...calls];
            next[idx] = { ...next[idx], status: data.status };
            return { ...msg, toolCalls: next };
          }
          return { ...msg, toolCalls: [...calls, data] };
        }),
      );
    });
    es.addEventListener("done", () => {
      setStreaming(false);
      es.close();
    });
    es.addEventListener("error", () => {
      setStreaming(false);
      es.close();
    });

    // Send the prompt
    try {
      await fetch(`/api/lead-agent/${chatId}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
    } catch {
      setStreaming(false);
      es.close();
      setMessages((m) =>
        m.map((msg) =>
          msg.id === placeholderId
            ? { ...msg, text: "❌ Erreur de connexion à l'agent." }
            : msg,
        ),
      );
    }
  }, [input, streaming, activeChatId]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
      {/* Sessions sidebar */}
      <div className="order-2 lg:order-1">
        <button
          onClick={newChat}
          className="btn-solid mb-3 inline-flex w-full items-center justify-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Nouvelle session
        </button>
        <div className="space-y-1">
          {chats.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              Aucune session pour l&apos;instant.
            </p>
          ) : (
            chats.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveChatId(c.id)}
                className={`w-full truncate rounded-md px-3 py-2 text-left text-sm transition ${
                  c.id === activeChatId
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <div className="truncate">{c.title || "Sans titre"}</div>
                <div className="truncate text-[11px] opacity-60">
                  {new Date(c.last_message_at).toLocaleString("fr-FR", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Chat panel */}
      <Panel padding="none" className="order-1 flex flex-col rounded-sm lg:order-2 lg:h-[calc(100vh-220px)]">
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-5 py-6 lg:px-8"
        >
          {loadingHistory ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <EmptyState userEmail={userEmail} />
          ) : (
            <div className="mx-auto max-w-2xl space-y-6">
              {messages.map((m) => (
                <Message key={m.id} message={m} />
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-border px-4 py-3 lg:px-6 lg:py-4">
          <div className="mx-auto max-w-2xl">
            <div className="flex items-end gap-2 rounded-lg border border-border bg-background p-2 focus-within:ring-1 focus-within:ring-ring">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Trouve-moi 20 restaurants à Lyon sans site web décent..."
                rows={2}
                disabled={streaming}
                className="min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none disabled:opacity-50"
              />
              <button
                onClick={send}
                disabled={!input.trim() || streaming}
                className="btn-solid inline-flex h-9 w-9 items-center justify-center rounded-md p-0 disabled:opacity-50"
                aria-label="Envoyer"
              >
                {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Entrée pour envoyer · Shift+Entrée pour saut de ligne · Connecté à OpenCode sur le VPS
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function EmptyState({ userEmail }: { userEmail: string }) {
  const samples = [
    "Trouve-moi 15 restaurants à Lyon 2 sans site web et avec >100 avis Google.",
    "Qualifie le restaurant Le Pré Salé à Paris 11.",
    "Liste mes 10 leads les plus chauds dans la base, par score.",
    "Rédige un email d'approche pour Boulangerie Dupont à Marseille (pas de site).",
  ];
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center py-16 text-center">
      <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full border border-border">
        <RotateCcw className="h-5 w-5 text-muted-foreground" strokeWidth={1.25} />
      </div>
      <h2 className="font-display text-xl">Salut {userEmail.split("@")[0]} 👋</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Donne-moi une mission ou choisis un exemple :
      </p>
      <div className="mt-5 grid w-full grid-cols-1 gap-2">
        {samples.map((s) => (
          <button
            key={s}
            onClick={() => {
              const ta = document.querySelector("textarea") as HTMLTextAreaElement | null;
              if (ta) {
                ta.value = s;
                ta.dispatchEvent(new Event("input", { bubbles: true }));
                ta.focus();
              }
            }}
            className="rounded-md border border-border bg-background px-4 py-3 text-left text-sm text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Message({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-foreground px-4 py-2.5 text-sm text-background">
          {message.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {message.toolCalls.map((tc, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${
                tc.status === "running"
                  ? "border-blue-300 bg-blue-50 text-blue-700"
                  : tc.status === "error"
                  ? "border-red-300 bg-red-50 text-red-700"
                  : "border-border bg-muted text-muted-foreground"
              }`}
            >
              {tc.status === "running" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
              {tc.name}
            </span>
          ))}
        </div>
      )}
      {message.text ? (
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.text}</div>
      ) : (
        <div className="text-sm text-muted-foreground">
          <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> ...
        </div>
      )}
    </div>
  );
}
