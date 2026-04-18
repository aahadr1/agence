/**
 * RAG / knowledge retrieval façade (stub — wire embeddings + chunk table later).
 */

import { registerTool } from "../tool-registry";

registerTool(
  {
    name: "knowledge_retrieve",
    description:
      "Recherche dans la base de connaissances interne (stub). Retourne des passages citables une fois branché sur embeddings / chunks Postgres.",
    parameters: {
      query: { type: "string", description: "Requête en langage naturel" },
      top_k: { type: "number", description: "Nombre max de passages", required: false },
    },
    required: ["query"],
    costEstimateCents: 0,
    riskLevel: "green",
  },
  async (args) => {
    const q = String(args.query || "").trim();
    const topK = Math.min(Math.max(Number(args.top_k) || 5, 1), 20);
    return {
      query: q,
      top_k: topK,
      hits: [] as Array<{ title: string; excerpt: string; source_id: string }>,
      note:
        "Stub : indexer vos SOP / propositions dans une table `knowledge_chunks` + `pgvector`, puis interroger ici.",
    };
  },
);
