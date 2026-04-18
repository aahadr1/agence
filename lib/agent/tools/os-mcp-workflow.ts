/**
 * MCP adapter (stub) + durable job enqueue (Inngest when configured).
 */

import { registerTool } from "../tool-registry";
import { isHardBlockedRedTool, isRedToolAllowedFromEnv } from "../os/permissions";

registerTool(
  {
    name: "mcp_invoke",
    description:
      "Appelle un outil MCP externe (stub). Nécessite configuration MCP côté serveur et AGENT_ALLOW_RED_TOOLS=1 pour exécution réelle — sinon erreur explicite.",
    parameters: {
      server_id: { type: "string", description: "Identifiant serveur MCP" },
      tool_name: { type: "string", description: "Nom de l’outil MCP" },
      arguments: {
        type: "object",
        description: "Arguments JSON",
        required: false,
      },
    },
    required: ["server_id", "tool_name"],
    costEstimateCents: 0,
    riskLevel: "red",
  },
  async (args) => {
    if (!isRedToolAllowedFromEnv() && isHardBlockedRedTool("mcp_invoke")) {
      throw new Error(
        "mcp_invoke désactivé par défaut. Configurez des serveurs MCP côté infra et AGENT_ALLOW_RED_TOOLS=1 si vous acceptez l’exécution distante.",
      );
    }
    return {
      ok: false,
      stub: true,
      server_id: String(args.server_id),
      tool_name: String(args.tool_name),
      message:
        "Implémentation MCP à brancher : voir lib/mcp/client.ts (interface McpAdapter).",
    };
  },
);

registerTool(
  {
    name: "workflow_enqueue",
    description:
      "Met en file une tâche longue via Inngest (événement `agent/os.long_task`) si INNGEST_EVENT_KEY est défini. Sinon retourne skipped.",
    parameters: {
      name: { type: "string", description: "Nom logique du job" },
      payload: { type: "object", description: "Données JSON sérialisables" },
    },
    required: ["name", "payload"],
    costEstimateCents: 0,
    riskLevel: "yellow",
  },
  async (args, context) => {
    const name = String(args.name || "").slice(0, 120);
    const payload = {
      ...((args.payload as Record<string, unknown>) || {}),
      org_id: context.orgId,
      user_id: context.userId,
      session_id: context.sessionId,
    };
    try {
      const { inngest } = await import("@/lib/inngest/client");
      if (!process.env.INNGEST_EVENT_KEY) {
        return { ok: false, skipped: true, reason: "INNGEST_EVENT_KEY not set" };
      }
      await inngest.send({
        name: "agent/os.long_task",
        data: { jobName: name, payload },
      });
      return { ok: true, event: "agent/os.long_task", jobName: name };
    } catch (e) {
      return {
        ok: false,
        skipped: true,
        reason: e instanceof Error ? e.message : String(e),
      };
    }
  },
);

registerTool(
  {
    name: "workspace_run_command",
    description:
      "Shell arbitraire — volontairement bloqué sur l’hôte agent. Utilisez les outils repo_*, workspace_*, ou CI local (Cursor).",
    parameters: {
      command: { type: "string", description: "Commande (non exécutée par défaut)" },
    },
    required: ["command"],
    costEstimateCents: 0,
    riskLevel: "red",
  },
  async () => {
    if (!isRedToolAllowedFromEnv()) {
      throw new Error(
        "workspace_run_command bloqué. AGENT_ALLOW_RED_TOOLS=1 requis pour toute exécution shell distante (non recommandé sur Vercel).",
      );
    }
    throw new Error("Non implémenté : exigerait sandbox dédiée.");
  },
);
