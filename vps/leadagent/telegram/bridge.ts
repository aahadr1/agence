/**
 * Telegram → OpenCode bridge.
 *
 * Long-polls Telegram, forwards messages from allowlisted users to the local
 * OpenCode server, streams the response back as a single Telegram message that
 * gets edited as tokens arrive.
 *
 * Run as: `bun run telegram/bridge.ts`
 *
 * Required env :
 *   TELEGRAM_BOT_TOKEN          — from @BotFather
 *   TELEGRAM_ALLOWED_USER_IDS   — comma-separated Telegram user IDs (security)
 *   OPENCODE_URL                — http://127.0.0.1:4096 (loopback inside VPS)
 *   OPENCODE_SERVER_PASSWORD    — Basic auth password (optional if no auth)
 *   OPENCODE_SERVER_USERNAME    — defaults to "opencode"
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

const auth = OC_PASS
  ? { Authorization: `Basic ${btoa(`${OC_USER}:${OC_PASS}`)}` }
  : {};

const client = createOpencodeClient({
  baseUrl: OC_URL,
  fetch: (url, init) =>
    fetch(url, { ...init, headers: { ...(init?.headers ?? {}), ...auth } }),
});

// ─── Persistence : map (chatId → opencodeSessionId) ──────────────────────────
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

// ─── Telegram API helpers ────────────────────────────────────────────────────
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;

async function tg(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: any; description?: string }> {
  const res = await fetch(`${TG_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sendMessage(chatId: number, text: string): Promise<number | null> {
  const r = await tg("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4096),
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  });
  return r.ok ? r.result.message_id : null;
}

async function editMessage(chatId: number, messageId: number, text: string): Promise<void> {
  await tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: text.slice(0, 4096),
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  });
}

async function sendChatAction(chatId: number, action = "typing"): Promise<void> {
  await tg("sendChatAction", { chat_id: chatId, action });
}

// ─── Get-or-create OpenCode session for this chat ────────────────────────────
async function getSessionId(chatId: number): Promise<string> {
  const key = String(chatId);
  if (sessions[key]) return sessions[key];
  const s = await client.session.create({ body: { title: `tg-${chatId}` } });
  if (!s.data?.id) throw new Error("session.create failed");
  sessions[key] = s.data.id;
  await saveSessions(sessions);
  return s.data.id;
}

// ─── Process one user message ────────────────────────────────────────────────
async function handleMessage(msg: any): Promise<void> {
  const chatId = msg.chat.id;
  const userId = String(msg.from?.id ?? "");
  const text = (msg.text ?? "").trim();
  if (!text) return;

  if (ALLOWED.length > 0 && !ALLOWED.includes(userId)) {
    await sendMessage(chatId, "⛔ Accès refusé.");
    console.log(`[bridge] denied user=${userId}`);
    return;
  }

  // Slash commands
  if (text === "/start") {
    await sendMessage(
      chatId,
      "👋 Salut Aaron — je suis ton agent.\n\nEnvoie-moi une mission et je m'y mets.\n\nCommandes :\n• /reset — nouvelle session\n• /status — état actuel",
    );
    return;
  }
  if (text === "/reset") {
    delete sessions[String(chatId)];
    await saveSessions(sessions);
    await sendMessage(chatId, "🆕 Session réinitialisée.");
    return;
  }
  if (text === "/status") {
    const sid = sessions[String(chatId)];
    await sendMessage(chatId, sid ? `📌 Session: \`${sid}\`` : "Pas de session active.");
    return;
  }

  await sendChatAction(chatId);
  const sessionId = await getSessionId(chatId);

  // Send placeholder, will be edited
  const placeholderId = await sendMessage(chatId, "⏳ ...");
  if (!placeholderId) return;

  // Subscribe BEFORE prompting so we don't miss events
  let buffer = "";
  let lastEdit = Date.now();
  let editTimer: Timer | null = null;
  const flush = async () => {
    if (!buffer.trim()) return;
    const now = Date.now();
    if (now - lastEdit < 1500) return; // throttle
    lastEdit = now;
    await editMessage(chatId, placeholderId, buffer.slice(-4000)).catch(() => {});
  };
  const scheduleFlush = () => {
    if (editTimer) clearTimeout(editTimer);
    editTimer = setTimeout(flush, 1500);
  };

  let stopped = false;
  const stream = await client.event.subscribe();
  const consume = (async () => {
    for await (const ev of stream.stream as AsyncIterable<any>) {
      if (stopped) break;
      try {
        if (ev.type === "message.part.updated" && ev.properties?.part?.sessionID === sessionId) {
          const part = ev.properties.part;
          if (part.type === "text" && typeof part.text === "string") {
            buffer = part.text;
            scheduleFlush();
          }
          if (part.type === "tool" && part.tool) {
            // Light annotation when a tool starts
            const status = part.state?.status;
            if (status === "running") {
              await sendChatAction(chatId).catch(() => {});
            }
          }
        }
        if (ev.type === "session.status" && ev.properties?.sessionID === sessionId) {
          const s = ev.properties.status?.type;
          if (s === "idle") {
            stopped = true;
            break;
          }
        }
      } catch (e) {
        console.error("[bridge] stream error", e);
      }
    }
  })();

  try {
    await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: "text", text }],
      },
    });
  } catch (e) {
    stopped = true;
    await editMessage(chatId, placeholderId, `❌ Erreur OpenCode : ${(e as Error).message}`);
    return;
  }

  await consume;
  if (editTimer) clearTimeout(editTimer);
  if (buffer.trim()) {
    await editMessage(chatId, placeholderId, buffer.slice(-4000)).catch(() => {});
  } else {
    await editMessage(chatId, placeholderId, "✅ (aucune réponse texte)").catch(() => {});
  }
}

// ─── Long-polling loop ───────────────────────────────────────────────────────
async function pollLoop() {
  console.log("[bridge] starting long-polling…");
  let offset = 0;
  while (true) {
    try {
      const r = await fetch(`${TG_API}/getUpdates?timeout=50&offset=${offset}`, {
        signal: AbortSignal.timeout(60_000),
      });
      const data = (await r.json()) as { ok: boolean; result?: any[] };
      if (!data.ok || !data.result) {
        await Bun.sleep(2000);
        continue;
      }
      for (const upd of data.result) {
        offset = Math.max(offset, upd.update_id + 1);
        if (upd.message?.text) {
          handleMessage(upd.message).catch((e) => console.error("[bridge] handle error", e));
        }
      }
    } catch (e) {
      console.error("[bridge] poll error", (e as Error).message);
      await Bun.sleep(3000);
    }
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────────
sessions = await loadSessions();
console.log(`[bridge] loaded ${Object.keys(sessions).length} session(s)`);
console.log(`[bridge] allowed users: ${ALLOWED.length ? ALLOWED.join(",") : "ALL"}`);
console.log(`[bridge] OpenCode URL: ${OC_URL}`);

// Health check before polling
try {
  const h = await fetch(`${OC_URL}/global/health`, {
    headers: auth,
    signal: AbortSignal.timeout(5000),
  });
  if (!h.ok) throw new Error(`HTTP ${h.status}`);
  console.log("[bridge] ✓ OpenCode health OK");
} catch (e) {
  console.error("[bridge] ✗ OpenCode unreachable:", (e as Error).message);
  console.error("[bridge] retrying in 10s...");
  await Bun.sleep(10_000);
}

await pollLoop();
