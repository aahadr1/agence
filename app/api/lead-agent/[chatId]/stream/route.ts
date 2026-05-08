/**
 * Server-Sent Events relay : OpenCode `/event` SSE → browser EventSource.
 * Filtré sur la session OpenCode liée à ce chat utilisateur.
 *
 * GET /api/lead-agent/:chatId/stream → text/event-stream
 *
 * Émet :
 *   event: text   data: { "text": "..." }
 *   event: tool   data: { "name": "...", "status": "running|done|error" }
 *   event: done   data: {}
 */
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getOpencodeBaseUrl, getOpencodeAuthHeader } from "@/lib/opencode/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const svc = await createServiceClient();
  const { data: chat } = await svc
    .from("agent_chats")
    .select("opencode_session_id, user_id")
    .eq("id", chatId)
    .single();
  if (!chat || chat.user_id !== user.id) {
    return new Response("not found", { status: 404 });
  }

  const sessionId = chat.opencode_session_id;
  const baseUrl = getOpencodeBaseUrl();
  const upstream = await fetch(`${baseUrl}/event`, {
    headers: { Accept: "text/event-stream", ...getOpencodeAuthHeader() },
    signal: AbortSignal.timeout(60 * 60 * 1000),
  });
  if (!upstream.ok || !upstream.body) {
    return new Response(`upstream ${upstream.status}`, { status: 502 });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  let buffer = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      // Heartbeat
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 15_000);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // OpenCode emits SSE: each event is `event: <name>\ndata: <json>\n\n`
          let nl: number;
          while ((nl = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 2);
            const lines = block.split("\n");
            const dataLine = lines.find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            try {
              const payload = JSON.parse(dataLine.slice(6));
              const t = payload.type as string | undefined;

              if (t === "message.part.updated") {
                const part = payload.properties?.part;
                if (!part || part.sessionID !== sessionId) continue;
                if (part.type === "text" && typeof part.text === "string") {
                  send("text", { text: part.text });
                } else if (part.type === "tool" && part.tool) {
                  const status = part.state?.status;
                  const mapped =
                    status === "running"
                      ? "running"
                      : status === "completed"
                      ? "done"
                      : "error";
                  send("tool", { name: part.tool, status: mapped });
                }
              } else if (t === "session.status") {
                if (payload.properties?.sessionID !== sessionId) continue;
                if (payload.properties?.status?.type === "idle") {
                  send("done", {});
                  break;
                }
              }
            } catch {
              /* malformed JSON line, skip */
            }
          }
        }
      } catch (e) {
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ error: (e as Error).message })}\n\n`,
          ),
        );
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
