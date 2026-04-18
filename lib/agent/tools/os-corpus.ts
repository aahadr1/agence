/**
 * Persist sources, artifacts, and decisions for the Agent OS memory model.
 */

import { registerTool } from "../tool-registry";
import {
  insertAgentOsArtifact,
  insertAgentOsDecision,
  insertAgentOsSource,
} from "../os/store";

registerTool(
  {
    name: "os_record_source",
    description:
      "Enregistre une source web dans la mémoire durable de la session (URL, titre, extrait, score de confiance optionnel).",
    parameters: {
      url: { type: "string", description: "URL canonique de la source" },
      title: { type: "string", description: "Titre", required: false },
      snippet: { type: "string", description: "Extrait ou snippet", required: false },
      trust_score: {
        type: "number",
        description: "Score 0–1 ou 0–100 (libre)",
        required: false,
      },
    },
    required: ["url"],
    costEstimateCents: 0,
    riskLevel: "green",
  },
  async (args, context) => {
    if (!context.sessionId) throw new Error("os_record_source requires session");
    const id = await insertAgentOsSource({
      sessionId: context.sessionId,
      orgId: context.orgId,
      userId: context.userId,
      url: String(args.url),
      title: args.title != null ? String(args.title) : null,
      snippet: args.snippet != null ? String(args.snippet) : null,
      trustScore:
        args.trust_score != null ? Number(args.trust_score) : undefined,
    });
    return { id, ok: Boolean(id) };
  },
);

registerTool(
  {
    name: "os_save_artifact",
    description:
      "Sauvegarde un livrable (rapport JSON/Markdown, synthèse) lié à la session, avec citations JSON optionnelles.",
    parameters: {
      kind: { type: "string", description: "report | brief | notes | other" },
      title: { type: "string", description: "Titre du livrable", required: false },
      body: { type: "string", description: "Contenu principal", required: false },
      citations: {
        type: "array",
        description: "Liste de citations {url, claim, ...}",
        required: false,
      },
    },
    required: ["kind"],
    costEstimateCents: 0,
    riskLevel: "yellow",
  },
  async (args, context) => {
    if (!context.sessionId) throw new Error("os_save_artifact requires session");
    const citations = Array.isArray(args.citations) ? args.citations : [];
    const id = await insertAgentOsArtifact({
      sessionId: context.sessionId,
      orgId: context.orgId,
      userId: context.userId,
      kind: String(args.kind),
      title: args.title != null ? String(args.title) : null,
      body: args.body != null ? String(args.body) : null,
      citations,
    });
    return { id, ok: Boolean(id) };
  },
);

registerTool(
  {
    name: "os_record_decision",
    description:
      "Trace une décision d’arbitrage (qualification, rejet homonyme, stratégie) avec classe de risque.",
    parameters: {
      decision: { type: "string", description: "Décision en une phrase" },
      rationale: { type: "string", description: "Pourquoi", required: false },
      risk_class: {
        type: "string",
        description: "green | yellow | red",
        enum: ["green", "yellow", "red"],
        required: false,
      },
      needs_approval: {
        type: "boolean",
        description: "Si une validation humaine est requise",
        required: false,
      },
    },
    required: ["decision"],
    costEstimateCents: 0,
    riskLevel: "green",
  },
  async (args, context) => {
    if (!context.sessionId) throw new Error("os_record_decision requires session");
    const rc = (args.risk_class as string) || "green";
    if (!["green", "yellow", "red"].includes(rc)) throw new Error("invalid risk_class");
    const id = await insertAgentOsDecision({
      sessionId: context.sessionId,
      orgId: context.orgId,
      userId: context.userId,
      decision: String(args.decision),
      rationale: args.rationale != null ? String(args.rationale) : null,
      riskClass: rc as "green" | "yellow" | "red",
      needsApproval: Boolean(args.needs_approval),
    });
    return { id, ok: Boolean(id) };
  },
);
