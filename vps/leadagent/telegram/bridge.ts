/**
 * Telegram → OpenCode bridge.
 *
 * Long-polls Telegram → envoie le texte au serveur local OpenCode → met à jour
 * un même message Telegram au fil de la réponse (polling des messages OpenCode).
 *
 * Run as: `bun run telegram/bridge.ts`
 *
 * Important : pas de parse_mode Telegram sur les réponses du LLM sinon les edits
 * échouent silencieusement (underscores, listes Markdown, etc.) et tu restes
 * bloqué sur « ⏳ ... ».
 */

import { createOpencodeClient } from "@opencode-ai/sdk";

const TG_TOKEN = required("TELEGRAM_BOT_TOKEN");
const ALLOWED = (process.env.TELEGRAM_ALLOWED_USER_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OC_URL = process.env.OPENCODE_URL ?? "http://127.0.0.1:4096";
const OC_USER = process.env.OPENCODE_SERVER_USERNAME ?? "opencode";
const OC_PASS = process.env.OPENCODE_SERVER_PASSWORD;
const SESSION_FILE = `${process.cwd()}/data/telegram-sessions.json`;

if (ALLOWED.length === 0) {
  console.warn("[bridge] ⚠ TELEGRAM_ALLOWED_USER_IDS vide — TOUT LE MONDE peut parler au bot.");
}

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const headers: HeadersInit =
  OC_PASS && OC_PASS.trim() !== ""
    ? { Authorization: `Basic ${btoa(`${OC_USER}:${OC_PASS}`)}` }
    : {};

const client = createOpencodeClient({
  baseUrl: OC_URL,
  fetch: (url, init) => fetch(url as RequestInfo, { ...init, headers: { ...headers, ...(init?.headers as object) } }),
});

// ─── Sessions persistées ─────────────────────────────────────────────────────
type SessionMap = Record<string, string>;
async function loadSessions(): Promise<SessionMap> {
  try {
    const f = Bun.file(SESSION_FILE);
    if (!(await f.exists())) return {};
    return (await f.json()) as SessionMap;
  } catch {
    return {};
  }
}
async function saveSessions(m: SessionMap): Promise<void> {
  await Bun.write(SESSION_FILE, JSON.stringify(m, null, 2));
}

let sessions: SessionMap = {};

// ─── Telegram (sans Markdown : évite 400Bad Request sur editMessageText) ───
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;

async function tg(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const res = await fetch(`${TG_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<{ ok: boolean; result?: unknown; description?: string }>;
}

async function sendMessage(chatId: number, text: string): Promise<number | null> {
  const r = await tg("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4096),
    disable_web_page_preview: true,
  });
  if (!r.ok) {
    console.error("[bridge] sendMessage:", r.description);
    return null;
  }
  return (r.result as { message_id: number }).message_id;
}

async function editMessage(chatId: number, messageId: number, text: string): Promise<void> {
  const r = await tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: text.slice(0, 4096),
    disable_web_page_preview: true,
  });
  if (!r.ok && r.description && !String(r.description).includes("not modified"))
    console.error("[bridge] editMessage:", r.description);
}

async function sendChatAction(chatId: number, action = "typing"): Promise<void> {
  await tg("sendChatAction", { chat_id: chatId, action });
}

async function getLatestAssistantText(sessionId: string): Promise<string> {
  const res = await client.session.messages({ path: { id: sessionId } });
  const list = res.data as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(list) || list.length === 0) return "";

  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i] as { info?: { role?: string }; parts?: Array<{ type?: string; text?: string }> };
    const role = m.info?.role;
    if (role !== "assistant") continue;
    const parts = m.parts ?? [];
    let full = "";
    for (const p of parts)
      if (p.type === "text" && typeof p.text === "string") full += p.text;
    if (full.trim()) return full;
  }
  return "";
}

// ─── Get-or-create OpenCode session ──────────────────────────────────────────
async function getSessionId(chatId: number): Promise<string> {
  const key = String(chatId);
  if (sessions[key]) return sessions[key];
  const s = await client.session.create({ body: { title: `tg-${chatId}` } });
  const id = s.data?.id;
  if (!id) throw new Error("session.create failed");
  sessions[key] = id;
  await saveSessions(sessions);
  return id;
}

// ─── Message utilisateur ─────────────────────────────────────────────────────
async function handleMessage(msg: Record<string, unknown>): Promise<void> {
  const chat = msg.chat as { id: number } | undefined;
  const chatId = chat?.id;
  const from = msg.from as { id?: number } | undefined;
  const userId = String(from?.id ?? "");
  const text = ((msg.text as string | undefined) ?? "").trim();

  if (chatId == null || !text) return;

  if (ALLOWED.length > 0 && !ALLOWED.includes(userId)) {
    await sendMessage(chatId, "⛔ Accès refusé.");
    console.log("[bridge] denied user=" + userId);
    return;
  }

  if (text === "/start") {
    await sendMessage(
      chatId,
      "Salut Aaron — je suis ton agent.\n\nEnvoie-moi une mission.\n\nCommands:\n/start — aide\n/reset — nouvelle session OpenCode\n/status — id de session",
    );
    return;
  }
  if (text === "/reset") {
    delete sessions[String(chatId)];
    await saveSessions(sessions);
    await sendMessage(chatId, "Session réinitialisée (nouvelle à la prochaine question).");
    return;
  }
  if (text === "/status") {
    const sid = sessions[String(chatId)];
    await sendMessage(chatId, sid ? "Session OpenCode:\n" + sid : "Pas de session enregistrée.");
    return;
  }

  await sendChatAction(chatId);
  const sessionId = await getSessionId(chatId);

  const placeholderId = await sendMessage(chatId, "Réflexion… (quelques secondes à quelques minutes selon la mission)");
  if (!placeholderId) return;

  try {
    console.log("[bridge] prompt session=" + sessionId + " len=" + text.length);
    await client.session.prompt({
      path: { id: sessionId },
      body: { parts: [{ type: "text", text }] },
    });
  } catch (e) {
    console.error("[bridge] prompt error", e);
    await editMessage(chatId, placeholderId, "Erreur OpenCode : " + (e instanceof Error ? e.message : String(e)));
    return;
  }

  // SSE /event reste ouvert très longtemps → on fait confiance aux messages REST.
  const POLL_MS = 2800;
  const HARD_CAP_MS = 10 * 60 * 1000;
  let lastPrinted = "";
  let stableSlices = 0;
  const t0 = Date.now();

  while (Date.now() - t0 < HARD_CAP_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    await sendChatAction(chatId).catch(() => {});
    const body = await getLatestAssistantText(sessionId).catch(() => "");

    if (body !== lastPrinted) {
      lastPrinted = body;
      if (lastPrinted.trim())
        await editMessage(chatId, placeholderId, lastPrinted.slice(-4000));
      else await editMessage(chatId, placeholderId, "… en cours …");
      stableSlices = 0;
      continue;
    }

    if (lastPrinted.trim().length < 40) continue;

    stableSlices++;
    // ~22s sans changement = souvent réponse terminée (tools / rag peuvent avoir des pauses)
    if (stableSlices >= 8) break;
  }

  if (!lastPrinted.trim()) {
    await editMessage(
      chatId,
      placeholderId,
      "Réponse encore vide après l’attente. Vérifie DEEPSEEK_API_KEY puis : journalctl -u opencode -n 80",
    );
    return;
  }

  await editMessage(chatId, placeholderId, lastPrinted.slice(-4000));
}

// ─── Long-polling Telegram ───────────────────────────────────────────────────
async function pollLoop(): Promise<void> {
  console.log("[bridge] long-polling Telegram…");
  let offset = 0;
  while (true) {
    try {
      const r = await fetch(`${TG_API}/getUpdates?timeout=50&offset=${offset}`, {
        signal: AbortSignal.timeout(60_000),
      });
      const data = (await r.json()) as { ok: boolean; result?: unknown[] };
      if (!data.ok || !data.result?.length) {
        await Bun.sleep(2000);
        continue;
      }
      for (const upd of data.result) {
        const u = upd as Record<string, unknown>;
        offset = Math.max(offset, Number(u.update_id ?? 0) + 1);
        const mess = u.message as Record<string, unknown> | undefined;
        if (mess?.text) void handleMessage(mess).catch((e) => console.error("[bridge] handle error", e));
      }
    } catch (e) {
      console.error("[bridge] poll error:", e instanceof Error ? e.message : e);
      await Bun.sleep(3000);
    }
  }
}

sessions = await loadSessions();
console.log("[bridge] sessions chargées:", Object.keys(sessions).length);
console.log("[bridge] allowlist:", ALLOWED.length ? ALLOWED.join(",") : "OUVERT À TOUS");
console.log("[bridge] OPENCODE_URL:", OC_URL);

try {
  const h = await fetch(`${OC_URL}/global/health`, { headers, signal: AbortSignal.timeout(5000) });
  if (!h.ok) throw new Error("HTTP " + h.status);
  console.log("[bridge] ✓ OpenCode health OK");
} catch (e) {
  console.error("[bridge] ✗ OpenCode health:", e instanceof Error ? e.message : e);
  console.error("[bridge] attente 10s puis Telegram quand même…");
  await Bun.sleep(10_000);
}

await pollLoop();
