/**
 * Safe read-only workspace tools (repo tree under process.cwd()).
 * Writes / shell are intentionally not exposed here — use `repo_*` or Cursor for patches.
 */

import type { Dirent } from "fs";
import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { registerTool } from "../tool-registry";

const ROOT = process.cwd();
const ALLOW_TOP = new Set([
  "lib",
  "app",
  "components",
  "workers",
  "scripts",
  "docs",
  "supabase",
  "public",
]);

function resolveUnderRoot(rel: string): string {
  const cleaned = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = path.resolve(ROOT, cleaned);
  if (!abs.startsWith(ROOT)) {
    throw new Error("path escapes project root");
  }
  const relFromRoot = path.relative(ROOT, abs);
  const top = relFromRoot.split(path.sep).filter(Boolean)[0];
  if (top && !ALLOW_TOP.has(top)) {
    throw new Error(
      `path must start under one of: ${[...ALLOW_TOP].join(", ")}`,
    );
  }
  return abs;
}

async function walkFiles(dir: string, maxFiles: number): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    if (out.length >= maxFiles) return;
    let entries: Dirent[];
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(ts|tsx|md|sql|json)$/i.test(e.name)) out.push(path.relative(ROOT, p));
    }
  }
  await walk(dir);
  return out;
}

registerTool(
  {
    name: "workspace_list_files",
    description:
      "Liste fichiers source (.ts,.tsx,.md,.sql,.json) sous le dépôt, racines autorisées: lib/, app/, … Profondeur bornée (max ~400 fichiers).",
    parameters: {
      subdirectory: {
        type: "string",
        description: "Chemin relatif depuis la racine repo (ex: lib/agent)",
        required: false,
      },
    },
    required: [],
    costEstimateCents: 0,
    riskLevel: "green",
  },
  async (args) => {
    const sub = String(args.subdirectory || ".").trim() || ".";
    const base = resolveUnderRoot(sub);
    const st = await stat(base);
    if (!st.isDirectory()) throw new Error("subdirectory must be a directory");
    const files = await walkFiles(base, 400);
    return { root: ROOT, subdirectory: sub, count: files.length, files };
  },
);

registerTool(
  {
    name: "workspace_read_file",
    description:
      "Lit un fichier texte du dépôt (max ~400 ko). Chemin relatif autorisé comme pour workspace_list_files.",
    parameters: {
      path: { type: "string", description: "Chemin relatif (ex: lib/agent/engine.ts)" },
    },
    required: ["path"],
    costEstimateCents: 0,
    riskLevel: "green",
  },
  async (args) => {
    const rel = String(args.path || "").trim();
    if (!rel) throw new Error("path required");
    const abs = resolveUnderRoot(rel);
    const st = await stat(abs);
    if (!st.isFile()) throw new Error("not a file");
    if (st.size > 420_000) throw new Error("file too large (>400kb)");
    const content = await readFile(abs, "utf8");
    return { path: rel, length: content.length, content };
  },
);

registerTool(
  {
    name: "workspace_search_code",
    description:
      "Recherche textuelle simple (sous-chaîne) dans les .ts/.tsx sous lib/ et app/ (max 120 fichiers par racine).",
    parameters: {
      needle: { type: "string", description: "Texte à chercher (non regex)" },
      max_hits: { type: "number", description: "Max résultats (défaut 40)", required: false },
    },
    required: ["needle"],
    costEstimateCents: 0,
    riskLevel: "green",
  },
  async (args) => {
    const needle = String(args.needle || "");
    if (needle.length < 2) throw new Error("needle too short");
    const maxHits = Math.min(Math.max(Number(args.max_hits) || 40, 1), 100);
    const hits: Array<{ file: string; line: number; excerpt: string }> = [];
    for (const root of ["lib", "app"]) {
      const base = path.join(ROOT, root);
      const files = await walkFiles(base, 120);
      for (const f of files) {
        if (hits.length >= maxHits) break;
        const abs = path.join(ROOT, f);
        let text: string;
        try {
          text = await readFile(abs, "utf8");
        } catch {
          continue;
        }
        if (!text.includes(needle)) continue;
        const line = text.split("\n").findIndex((l) => l.includes(needle)) + 1;
        const excerpt = text.split("\n")[line - 1]?.slice(0, 200) || "";
        hits.push({ file: f, line, excerpt });
      }
    }
    return { needle, count: hits.length, hits };
  },
);
