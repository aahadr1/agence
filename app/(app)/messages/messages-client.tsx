"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Hash,
  Loader2,
  MessageCircle,
  Plus,
  Search,
  Send,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Conv = {
  id: string;
  type: string;
  title: string | null;
  slug: string | null;
  updated_at: string;
  dmLabel?: string | null;
  peerUserId?: string | null;
};

type Msg = {
  id: string;
  body: string;
  author_id: string;
  created_at: string;
};

type ProfileRow = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  title: string | null;
  default_status_text: string | null;
};

type MeProfile = {
  user_id: string;
  display_name: string | null;
  title: string | null;
  default_status_text: string | null;
};

// Mention UX: show `@Display Name` in the textarea, but keep an invisible,
// zero-width encoded UUID so backend tagging (regex @uuid) keeps working.
const ZW_START = "\u2061"; // FUNCTION APPLICATION
const ZW_END = "\u2063"; // INVISIBLE SEPARATOR
const ZW_SYMBOLS = ["\u200B", "\u200C", "\u200D", "\u2060"] as const; // 4 zero-width symbols

function encodeUuidToZeroWidth(uuid: string) {
  const hex = uuid.replace(/-/g, "").toLowerCase(); // 32 chars
  const digits = hex.split("");
  let out = "";
  for (const ch of digits) {
    const n = parseInt(ch, 16); // 0..15
    const hi = Math.floor(n / 4); // 0..3
    const lo = n % 4; // 0..3
    out += ZW_SYMBOLS[hi] + ZW_SYMBOLS[lo];
  }
  return out;
}

function decodeZeroWidthToUuid(encoded: string) {
  const chars = encoded.split("");
  const hexDigits: string[] = [];
  for (let i = 0; i < chars.length; i += 2) {
    const a = chars[i];
    const b = chars[i + 1];
    const hi = ZW_SYMBOLS.indexOf(a as (typeof ZW_SYMBOLS)[number]);
    const lo = ZW_SYMBOLS.indexOf(b as (typeof ZW_SYMBOLS)[number]);
    if (hi < 0 || lo < 0) continue;
    const n = hi * 4 + lo; // 0..15
    hexDigits.push(n.toString(16));
  }
  const hex = hexDigits.join("").slice(0, 32);
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20)
  );
}

function serializeMentionsForServer(input: string) {
  // Replace each invisible mention token with `@<uuid>`.
  let output = input;
  while (true) {
    const startIdx = output.indexOf(ZW_START);
    if (startIdx === -1) break;
    const endIdx = output.indexOf(ZW_END, startIdx + ZW_START.length);
    if (endIdx === -1) break;

    const encoded = output.slice(startIdx + ZW_START.length, endIdx);
    const uuid = decodeZeroWidthToUuid(encoded);

    const atIdx = output.lastIndexOf("@", startIdx);
    if (atIdx === -1) break;

    output =
      output.slice(0, atIdx) +
      `@${uuid}` +
      output.slice(endIdx + ZW_END.length);
  }
  return output;
}

function initials(name: string | null | undefined, fallback: string) {
  const s = (name || fallback).trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  }
  return s.slice(0, 2).toUpperCase() || "?";
}

function formatDayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (today.getTime() - msgDay.getTime()) / 86400000;
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Hier";
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function isPlaceholderName(name: string | null | undefined) {
  if (!name?.trim()) return true;
  return name.trim() === "Member";
}

export function MessagesClient({
  conversationId,
}: {
  conversationId?: string;
}) {
  const router = useRouter();
  const { user: authUser } = useAuth();
  const supabase = createClient();

  const [conversations, setConversations] = useState<Conv[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [body, setBody] = useState("");
  const [profiles, setProfiles] = useState<Record<string, ProfileRow>>({});
  const [presence, setPresence] = useState<Record<string, string>>({});
  const [me, setMe] = useState<MeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [mobileList, setMobileList] = useState(true);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [channelOpen, setChannelOpen] = useState(false);
  const [channelBusy, setChannelBusy] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newTitle, setNewTitle] = useState("");

  const [formName, setFormName] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formStatus, setFormStatus] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);

  const loadProfile = useCallback(async () => {
    const res = await fetch("/api/profiles/me");
    const data = await res.json();
    if (!res.ok) return;
    setMe(data.profile ?? null);
    if (data.profile) {
      setFormName(data.profile.display_name || "");
      setFormTitle(data.profile.title || "");
      setFormStatus(data.profile.default_status_text || "");
    }
  }, []);

  const loadConversations = useCallback(async () => {
    await fetch("/api/messages/bootstrap", { method: "POST" });
    const res = await fetch("/api/messages/conversations");
    const data = await res.json();
    if (res.ok) setConversations(data.conversations || []);
  }, []);

  const loadDirectory = useCallback(async () => {
    const res = await fetch("/api/profiles/directory");
    const data = await res.json();
    if (!res.ok) return;
    const map: Record<string, ProfileRow> = {};
    for (const p of data.profiles || []) {
      const row = p as ProfileRow;
      map[row.user_id] = row;
    }
    setProfiles(map);
  }, []);

  const loadPresence = useCallback(async () => {
    const res = await fetch("/api/presence");
    if (!res.ok) return;
    const data = await res.json();
    setPresence((data.presence as Record<string, string>) || {});
  }, []);

  const loadMessages = useCallback(async (cid: string) => {
    const res = await fetch(`/api/messages/conversations/${cid}/messages`);
    const data = await res.json();
    if (res.ok) setMessages(data.messages || []);
  }, []);

  const bootRef = useRef(false);
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    queueMicrotask(() => {
      void (async () => {
        setLoading(true);
        try {
          // Parallelize the initial payloads to make navigation feel instant.
          await Promise.all([
            loadProfile(),
            loadConversations(),
            loadDirectory(),
            loadPresence(),
          ]);
          fetch("/api/presence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: "online" }),
          }).catch(() => {});
        } finally {
          setLoading(false);
        }
      })();
    });
  }, [loadConversations, loadDirectory, loadPresence, loadProfile]);

  useEffect(() => {
    if (loading) return;
    const needs = !me || isPlaceholderName(me.display_name);
    setOnboardingOpen(needs);
  }, [me, loading]);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(
        `/api/messages/conversations/${conversationId}/messages`
      );
      const data = await res.json();
      if (!cancelled && res.ok) setMessages(data.messages || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    const ch = supabase
      .channel(`msg:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as Msg;
          setMessages((prev) =>
            prev.some((m) => m.id === row.id) ? prev : [...prev, row]
          );
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [conversationId, supabase]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (conversationId) setMobileList(false);
  }, [conversationId]);

  const nameMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [id, p] of Object.entries(profiles)) {
      m[id] = p.display_name?.trim() || id.slice(0, 6);
    }
    return m;
  }, [profiles]);

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === conversationId),
    [conversations, conversationId]
  );

  const headerTitle = useMemo(() => {
    if (!activeConv) return "Messagerie";
    if (activeConv.type === "channel") {
      return `#${activeConv.slug || activeConv.title || "canal"}`;
    }
    return activeConv.dmLabel || "Message direct";
  }, [activeConv]);

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const label =
        c.type === "channel"
          ? (c.slug || c.title || "").toLowerCase()
          : (c.dmLabel || "").toLowerCase();
      return label.includes(q);
    });
  }, [conversations, search]);

  const channels = filteredConversations.filter((c) => c.type === "channel");
  const dms = filteredConversations.filter((c) => c.type === "dm");

  const directoryList = useMemo(() => {
    return Object.values(profiles)
      .filter((p) => p.user_id !== authUser?.id)
      .sort((a, b) => {
        const na = a.display_name || "";
        const nb = b.display_name || "";
        return na.localeCompare(nb, "fr");
      });
  }, [profiles, authUser?.id]);

  const mentionCandidates = useMemo(() => {
    const q = mentionFilter.toLowerCase();
    return directoryList.filter((p) => {
      const name = (p.display_name || "").toLowerCase();
      return !q || name.includes(q);
    });
  }, [directoryList, mentionFilter]);

  const send = async () => {
    if (!conversationId || !body.trim() || sending) return;
    const serverBody = serializeMentionsForServer(body);
    setSending(true);
    try {
      const res = await fetch(
        `/api/messages/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: serverBody }),
        }
      );
      if (res.ok) {
        setBody("");
        setMentionOpen(false);
        await loadMessages(conversationId);
        await loadConversations();
      }
    } finally {
      setSending(false);
    }
  };

  const startDm = async (peerUserId: string) => {
    const res = await fetch("/api/messages/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "dm", peerUserId }),
    });
    const data = await res.json();
    if (res.ok && data.conversationId) {
      router.push(`/messages/${data.conversationId}`);
      await loadConversations();
      setMobileList(false);
    }
  };

  const submitOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = formName.trim();
    if (name.length < 2) return;
    setOnboardingBusy(true);
    try {
      const res = await fetch("/api/profiles/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: name,
          title: formTitle.trim() || null,
          default_status_text: formStatus.trim() || null,
        }),
      });
      if (!res.ok) return;
      await loadProfile();
      await loadConversations();
      await fetch("/api/messages/bootstrap", { method: "POST" });
      await loadConversations();
      const listRes = await fetch("/api/messages/conversations");
      const listData = await listRes.json();
      const list = (listData.conversations || []) as Conv[];
      setConversations(list);
      const general =
        list.find((c) => c.type === "channel" && c.slug === "general") ||
        list[0];
      if (general) {
        router.push(`/messages/${general.id}`);
      }
      setOnboardingOpen(false);
    } finally {
      setOnboardingBusy(false);
    }
  };

  const createChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    const slug = newSlug.trim().toLowerCase().replace(/\s+/g, "-");
    if (!slug || slug.length < 2) return;
    setChannelBusy(true);
    try {
      const res = await fetch("/api/messages/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "channel",
          slug,
          title: newTitle.trim() || slug,
        }),
      });
      const data = await res.json();
      if (res.ok && data.conversationId) {
        setChannelOpen(false);
        setNewSlug("");
        setNewTitle("");
        router.push(`/messages/${data.conversationId}`);
        await loadConversations();
        setMobileList(false);
      }
    } finally {
      setChannelBusy(false);
    }
  };

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && mentionCandidates.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) =>
          Math.min(i + 1, mentionCandidates.length - 1)
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const pick = mentionCandidates[mentionIndex];
        if (pick) insertMention(pick);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const insertMention = (pick: ProfileRow) => {
    const ta = inputRef.current;
    if (!ta) return;
    const v = body;
    const cursor = ta.selectionStart;
    const before = v.slice(0, cursor);
    const after = v.slice(cursor);
    const at = before.lastIndexOf("@");
    if (at === -1) return;

    const display = (pick.display_name || pick.user_id).trim();
    const encoded = encodeUuidToZeroWidth(pick.user_id);
    const mentionToken = `@${display}${ZW_START}${encoded}${ZW_END}`;

    const next = `${before.slice(0, at)}${mentionToken} ${after}`;
    setBody(next);
    setMentionOpen(false);
    setMentionFilter("");
    requestAnimationFrame(() => {
      ta.focus();
      const pos = at + mentionToken.length + 1; // +1 for the added trailing space
      ta.setSelectionRange(pos, pos);
    });
  };

  const onComposerChange = (v: string) => {
    setBody(v);
    const ta = inputRef.current;
    if (!ta) {
      setMentionOpen(false);
      return;
    }
    const cursor = ta.selectionStart;
    const before = v.slice(0, cursor);
    const at = before.lastIndexOf("@");
    if (at === -1) {
      setMentionOpen(false);
      return;
    }
    const frag = before.slice(at + 1);
    if (frag.includes(" ") || frag.includes("\n")) {
      setMentionOpen(false);
      return;
    }
    setMentionOpen(true);
    setMentionFilter(frag);
    setMentionIndex(0);
  };

  const groupedMessages = useMemo(() => {
    const groups: { day: string; items: Msg[] }[] = [];
    let currentDay = "";
    for (const m of messages) {
      const day = formatDayLabel(m.created_at);
      if (day !== currentDay) {
        currentDay = day;
        groups.push({ day, items: [m] });
      } else {
        groups[groups.length - 1].items.push(m);
      }
    }
    return groups;
  }, [messages]);

  const renderBody = (text: string) => {
    const parts = text.split(/(@[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi);
    return parts.map((part, i) => {
      const um = part.match(
        /^@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
      );
      if (um) {
        const label = nameMap[um[1]] || "collègue";
        return (
          <span
            key={i}
            className="rounded px-0.5 font-medium text-[var(--blue)]"
          >
            @{label}
          </span>
        );
      }
      return (
        <span key={i} className="whitespace-pre-wrap break-words">
          {part}
        </span>
      );
    });
  };

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-7 w-7 animate-spin" strokeWidth={1.25} />
        <p className="text-sm">Ouverture de la messagerie…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {onboardingOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal
          aria-labelledby="msg-onboard-title"
        >
          <div className="w-full max-w-md border border-border/80 bg-card p-8 shadow-xl">
            <div className="mb-6 flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--blue-subtle)] text-[var(--blue)]">
                <Sparkles className="h-5 w-5" strokeWidth={1.5} />
              </div>
              <div>
                <h2
                  id="msg-onboard-title"
                  className="text-lg font-semibold tracking-tight text-foreground"
                >
                  Rejoindre la messagerie
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Complétez votre profil pour que l&apos;équipe puisse vous
                  mentionner (@) et vous retrouver dans les canaux.
                </p>
              </div>
            </div>
            <form onSubmit={submitOnboarding} className="space-y-4">
              <div>
                <label
                  htmlFor="onb-name"
                  className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                >
                  Nom affiché *
                </label>
                <input
                  id="onb-name"
                  className="w-full border border-border bg-background px-3 py-2.5 text-sm outline-none ring-0 transition-[box-shadow] focus:border-foreground/25 focus:shadow-[0_0_0_3px_var(--blue-subtle)]"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex. Marie Dupont"
                  autoComplete="name"
                  required
                  minLength={2}
                />
              </div>
              <div>
                <label
                  htmlFor="onb-title"
                  className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                >
                  Rôle / titre
                </label>
                <input
                  id="onb-title"
                  className="w-full border border-border bg-background px-3 py-2.5 text-sm outline-none transition-[box-shadow] focus:border-foreground/25 focus:shadow-[0_0_0_3px_var(--blue-subtle)]"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Ex. Stratège, Designer…"
                />
              </div>
              <div>
                <label
                  htmlFor="onb-status"
                  className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                >
                  Statut court
                </label>
                <input
                  id="onb-status"
                  className="w-full border border-border bg-background px-3 py-2.5 text-sm outline-none transition-[box-shadow] focus:border-foreground/25 focus:shadow-[0_0_0_3px_var(--blue-subtle)]"
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value)}
                  placeholder="Ex. Disponible · En focus"
                />
              </div>
              <button
                type="submit"
                disabled={onboardingBusy || formName.trim().length < 2}
                className="btn-solid mt-2 flex w-full items-center justify-center gap-2 py-3 text-sm disabled:opacity-50"
              >
                {onboardingBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Entrer dans la messagerie
              </button>
            </form>
          </div>
        </div>
      )}

      {channelOpen && (
        <div
          className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal
        >
          <div className="w-full max-w-sm border border-border bg-card p-6 shadow-lg">
            <h3 className="text-base font-semibold">Nouveau canal</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Nom technique en minuscules, sans espaces.
            </p>
            <form onSubmit={createChannel} className="mt-5 space-y-3">
              <input
                className="w-full border border-border bg-background px-3 py-2 text-sm"
                placeholder="slug-du-canal"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
              />
              <input
                className="w-full border border-border bg-background px-3 py-2 text-sm"
                placeholder="Titre affiché (optionnel)"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => setChannelOpen(false)}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={channelBusy || newSlug.trim().length < 2}
                  className="btn-solid px-4 py-2 text-sm"
                >
                  {channelBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Créer"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside
          className={cn(
            "flex w-full min-w-0 flex-col border-r border-border/70 bg-muted/20 lg:w-[280px] lg:shrink-0",
            conversationId && !mobileList ? "hidden lg:flex" : "flex"
          )}
        >
          <div className="border-b border-border/60 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Messagerie
                </p>
                <p className="text-xs text-muted-foreground/90">
                  Canaux & messages directs
                </p>
              </div>
              <button
                type="button"
                onClick={() => setChannelOpen(true)}
                className="flex h-8 w-8 items-center justify-center rounded border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-background hover:text-foreground"
                title="Nouveau canal"
              >
                <Plus className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                className="w-full border border-border/80 bg-background py-2 pl-8 pr-3 text-[13px] outline-none placeholder:text-muted-foreground/70 focus:border-foreground/20"
                placeholder="Rechercher…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="px-2 pt-3">
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Canaux
              </p>
              <ul className="space-y-0.5">
                {channels.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/messages/${c.id}`}
                      onClick={() => setMobileList(false)}
                      className={cn(
                        "flex items-center gap-2 rounded-sm px-2 py-2 text-[13px] transition-colors",
                        c.id === conversationId
                          ? "bg-foreground/5 text-foreground"
                          : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
                      )}
                    >
                      <Hash
                        className="h-3.5 w-3.5 shrink-0 opacity-60"
                        strokeWidth={1.75}
                      />
                      <span className="truncate">
                        {c.slug || c.title || "canal"}
                      </span>
                    </Link>
                  </li>
                ))}
                {channels.length === 0 && (
                  <li className="px-2 py-3 text-xs text-muted-foreground">
                    Aucun canal. Créez-en un avec +.
                  </li>
                )}
              </ul>
            </div>

            <div className="px-2 pt-5">
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Messages directs
              </p>
              <ul className="space-y-0.5">
                {dms.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/messages/${c.id}`}
                      onClick={() => setMobileList(false)}
                      className={cn(
                        "flex items-center gap-2 rounded-sm px-2 py-2 text-[13px] transition-colors",
                        c.id === conversationId
                          ? "bg-foreground/5 text-foreground"
                          : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
                      )}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-[10px] font-medium">
                        {initials(c.dmLabel, "?")}
                      </span>
                      <span className="truncate">{c.dmLabel || "DM"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-6 border-t border-border/60 px-2 pb-4 pt-4">
              <p className="mb-2 flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Users className="h-3 w-3" strokeWidth={1.75} />
                Équipe
              </p>
              <ul className="max-h-[220px] space-y-0.5 overflow-y-auto">
                {directoryList.map((p) => {
                  const online = presence[p.user_id] === "online";
                  return (
                    <li key={p.user_id}>
                      <button
                        type="button"
                        onClick={() => void startDm(p.user_id)}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
                      >
                        <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-[10px] font-medium">
                          {p.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.avatar_url}
                              alt=""
                              className="h-full w-full rounded-full object-cover"
                            />
                          ) : (
                            initials(p.display_name, p.user_id)
                          )}
                          <span
                            className={cn(
                              "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-card",
                              online ? "bg-emerald-500" : "bg-muted-foreground/40"
                            )}
                          />
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {p.display_name || "Sans nom"}
                          {p.title ? (
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                              {p.title}
                            </span>
                          ) : null}
                        </span>
                        <MessageCircle
                          className="h-3.5 w-3.5 shrink-0 opacity-40"
                          strokeWidth={1.75}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </aside>

        {/* Thread */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          <header className="flex shrink-0 items-center gap-3 border-b border-border/60 px-3 py-3 lg:px-5">
            {conversationId && (
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded border border-border/80 text-muted-foreground lg:hidden"
                onClick={() => setMobileList(true)}
                aria-label="Retour aux conversations"
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[15px] font-semibold tracking-tight">
                {headerTitle}
              </h1>
              {activeConv?.type === "channel" && (
                <p className="truncate text-xs text-muted-foreground">
                  Canal de l&apos;agence · historique conservé
                </p>
              )}
              {activeConv?.type === "dm" && (
                <p className="truncate text-xs text-muted-foreground">
                  Message direct sécurisé
                </p>
              )}
            </div>
          </header>

          {!conversationId ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50 text-muted-foreground">
                <MessageCircle className="h-7 w-7" strokeWidth={1.25} />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Sélectionnez une conversation
                </p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Ouvrez un canal à gauche ou démarrez un message direct avec un
                  membre de l&apos;équipe.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 lg:px-6">
                {groupedMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center text-sm text-muted-foreground">
                    <p>Aucun message pour l’instant.</p>
                    <p className="mt-1 text-xs">
                      Écrivez le premier message ci-dessous.
                    </p>
                  </div>
                ) : (
                  groupedMessages.map((g) => (
                    <div key={g.day} className="mb-6">
                      <div className="mb-4 flex items-center gap-3">
                        <div className="h-px flex-1 bg-border/70" />
                        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          {g.day}
                        </span>
                        <div className="h-px flex-1 bg-border/70" />
                      </div>
                      <div className="space-y-4">
                        {g.items.map((m, idx) => {
                          const prev = g.items[idx - 1];
                          const sameAuthor =
                            prev && prev.author_id === m.author_id;
                          const showAvatar = !sameAuthor;
                          const label =
                            nameMap[m.author_id] ||
                            m.author_id.slice(0, 8);
                          return (
                            <div
                              key={m.id}
                              className={cn(
                                "flex gap-3",
                                sameAuthor ? "mt-0.5" : "mt-1"
                              )}
                            >
                              <div className="w-9 shrink-0">
                                {showAvatar ? (
                                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/[0.07] text-[11px] font-semibold text-foreground/90">
                                    {initials(
                                      profiles[m.author_id]?.display_name,
                                      m.author_id
                                    )}
                                  </div>
                                ) : null}
                              </div>
                              <div className="min-w-0 flex-1 pt-0.5">
                                {showAvatar ? (
                                  <div className="mb-0.5 flex items-baseline gap-2">
                                    <span className="text-[13px] font-semibold">
                                      {label}
                                    </span>
                                    <span className="text-[11px] text-muted-foreground">
                                      {formatTime(m.created_at)}
                                    </span>
                                  </div>
                                ) : null}
                                <div className="text-[14px] leading-relaxed text-foreground/95">
                                  {renderBody(m.body)}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
                <div ref={bottomRef} />
              </div>

              <div className="relative shrink-0 border-t border-border/60 bg-muted/10 px-3 py-3 lg:px-5">
                {mentionOpen && mentionCandidates.length > 0 && (
                  <div className="absolute bottom-full left-3 right-3 z-10 mb-2 max-h-48 overflow-y-auto border border-border bg-card py-1 shadow-lg lg:left-5 lg:right-5">
                    {mentionCandidates.slice(0, 12).map((p, i) => (
                      <button
                        key={p.user_id}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]",
                          i === mentionIndex
                            ? "bg-foreground/5"
                            : "hover:bg-foreground/[0.03]"
                        )}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          insertMention(p);
                        }}
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground/[0.06] text-[10px] font-medium">
                          {initials(p.display_name, p.user_id)}
                        </span>
                        <span className="truncate">
                          {p.display_name || "Sans nom"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2 rounded-lg border border-border/80 bg-background px-2 py-2 shadow-sm focus-within:border-foreground/15 focus-within:shadow-[0_0_0_3px_var(--blue-subtle)]">
                  <textarea
                    ref={inputRef}
                    className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2 text-[14px] leading-snug outline-none placeholder:text-muted-foreground/70"
                    placeholder={
                      activeConv?.type === "channel"
                        ? `Message #${activeConv.slug || "canal"} · @ pour mentionner`
                        : "Écrire un message… (@ pour mentionner)"
                    }
                    value={body}
                    onChange={(e) => onComposerChange(e.target.value)}
                    onKeyDown={onComposerKeyDown}
                    rows={1}
                  />
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={sending || !body.trim()}
                    className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-foreground text-background transition-opacity disabled:opacity-30"
                    title="Envoyer"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" strokeWidth={1.75} />
                    )}
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  <kbd className="rounded border border-border px-1 py-0.5 font-mono text-[10px]">
                    Entrée
                  </kbd>{" "}
                  envoyer ·{" "}
                  <kbd className="rounded border border-border px-1 py-0.5 font-mono text-[10px]">
                    Maj+Entrée
                  </kbd>{" "}
                  nouvelle ligne
                </p>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
