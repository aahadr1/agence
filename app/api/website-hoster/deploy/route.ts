import { createClient } from "@/lib/supabase/server";
import {
  hasGeminiApiKey,
  isGeminiQuotaLikeError,
  listGeminiApiKeysInOrder,
} from "@/lib/ai/gemini-keys";
import { GoogleGenerativeAI } from "@google/generative-ai";
import JSZip from "jszip";
import { NextResponse } from "next/server";

export const maxDuration = 60;

type UploadedEntry = {
  path: string;
  content: Buffer;
};

type Analysis = {
  framework: string | null;
  installCommand?: string;
  buildCommand?: string;
  outputDirectory?: string;
  rootDirectory?: string;
  reasoning: string;
};

const MAX_FILE_COUNT = 1000;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024; // 100 MB

function normalizePath(rawPath: string): string | null {
  const normalized = rawPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\/+/, "");
  if (!normalized || normalized.includes("..")) return null;
  return normalized;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function hasPath(files: UploadedEntry[], path: string): boolean {
  return files.some((f) => f.path === path);
}

function withRoot(files: UploadedEntry[], rootDirectory: string): UploadedEntry[] {
  const root = rootDirectory.replace(/^\/+|\/+$/g, "");
  if (!root) return files;

  const scoped = files
    .filter((f) => f.path === root || f.path.startsWith(`${root}/`))
    .map((f) => ({
      path: f.path.slice(root.length).replace(/^\/+/, ""),
      content: f.content,
    }))
    .filter((f) => f.path.length > 0);

  return scoped.length > 0 ? scoped : files;
}

function heuristicAnalysis(files: UploadedEntry[]): Analysis {
  const fileSet = new Set(files.map((f) => f.path));
  const rootHasIndex = fileSet.has("index.html");
  const packageEntry = files.find((f) => f.path.endsWith("package.json"));

  let packageJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
    name?: string;
  } | null = null;

  if (packageEntry) {
    try {
      packageJson = JSON.parse(packageEntry.content.toString("utf-8"));
    } catch {
      packageJson = null;
    }
  }

  const deps = {
    ...(packageJson?.dependencies || {}),
    ...(packageJson?.devDependencies || {}),
  };

  const scripts = packageJson?.scripts || {};

  const hasNext =
    "next" in deps ||
    hasPath(files, "next.config.js") ||
    hasPath(files, "next.config.mjs") ||
    hasPath(files, "next.config.ts");
  if (hasNext) {
    return {
      framework: "nextjs",
      installCommand: "npm install",
      buildCommand: scripts.build || "next build",
      outputDirectory: scripts.export ? "out" : ".next",
      reasoning: "Detected Next.js files/dependencies.",
    };
  }

  const hasVite =
    hasPath(files, "vite.config.ts") ||
    hasPath(files, "vite.config.js") ||
    "vite" in deps;
  if (hasVite) {
    return {
      framework: "vite",
      installCommand: "npm install",
      buildCommand: scripts.build || "npm run build",
      outputDirectory: "dist",
      reasoning: "Detected Vite config/dependency.",
    };
  }

  const hasAstro =
    hasPath(files, "astro.config.mjs") ||
    hasPath(files, "astro.config.ts") ||
    "astro" in deps;
  if (hasAstro) {
    return {
      framework: "astro",
      installCommand: "npm install",
      buildCommand: scripts.build || "npm run build",
      outputDirectory: "dist",
      reasoning: "Detected Astro config/dependency.",
    };
  }

  const hasNuxt =
    hasPath(files, "nuxt.config.ts") ||
    hasPath(files, "nuxt.config.js") ||
    "nuxt" in deps;
  if (hasNuxt) {
    return {
      framework: "nuxtjs",
      installCommand: "npm install",
      buildCommand: scripts.build || "npm run build",
      outputDirectory: ".output/public",
      reasoning: "Detected Nuxt config/dependency.",
    };
  }

  const hasReactScripts = "react-scripts" in deps;
  if (hasReactScripts) {
    return {
      framework: "create-react-app",
      installCommand: "npm install",
      buildCommand: scripts.build || "npm run build",
      outputDirectory: "build",
      reasoning: "Detected Create React App dependency.",
    };
  }

  if (packageEntry) {
    return {
      framework: null,
      installCommand: "npm install",
      buildCommand: scripts.build || "npm run build",
      outputDirectory: "dist",
      reasoning: "Detected Node project; defaulting to generic static output.",
    };
  }

  if (rootHasIndex) {
    return {
      framework: null,
      reasoning: "Detected root index.html static website.",
    };
  }

  const nestedIndex = files.find((f) => f.path.endsWith("/index.html"));
  if (nestedIndex) {
    const rootDirectory = nestedIndex.path.slice(0, -"index.html".length).replace(/\/+$/, "");
    return {
      framework: null,
      rootDirectory,
      reasoning: "Detected static website in nested folder.",
    };
  }

  return {
    framework: null,
    reasoning: "Unknown structure; deploying as static files.",
  };
}

async function analyzeWithGemini(files: UploadedEntry[], fallback: Analysis): Promise<Analysis> {
  if (!hasGeminiApiKey()) return fallback;

  const packageEntry = files.find((f) => f.path.endsWith("package.json"));
  const packageJsonPreview = packageEntry
    ? packageEntry.content.toString("utf-8").slice(0, 3000)
    : null;

  const fileList = files
    .slice(0, 400)
    .map((f) => f.path)
    .join("\n");

  const prompt = `You are a senior Vercel deployment engineer.
Return ONLY valid JSON with this schema:
{
  "framework": string | null,
  "installCommand": string | null,
  "buildCommand": string | null,
  "outputDirectory": string | null,
  "rootDirectory": string | null,
  "reasoning": string
}

Constraints:
- Prefer null framework for plain static websites.
- rootDirectory must be null OR exactly one directory from file list.
- Keep commands short and safe.
- If uncertain, keep values null and explain in reasoning.

Detected fallback analysis:
${JSON.stringify(fallback)}

Files:
${fileList}

package.json (optional):
${packageJsonPreview || "none"}
`;

  const keys = listGeminiApiKeysInOrder();
  for (let ki = 0; ki < keys.length; ki++) {
    const key = keys[ki]!;
    try {
      const model = new GoogleGenerativeAI(key).getGenerativeModel({
        model: "gemini-2.5-flash",
      });
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();

      const jsonStart = text.indexOf("{");
      const jsonEnd = text.lastIndexOf("}");
      if (jsonStart === -1 || jsonEnd <= jsonStart) return fallback;
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as {
        framework?: string | null;
        installCommand?: string | null;
        buildCommand?: string | null;
        outputDirectory?: string | null;
        rootDirectory?: string | null;
        reasoning?: string;
      };

      const normalized: Analysis = {
        framework: parsed.framework ?? fallback.framework,
        installCommand: parsed.installCommand || undefined,
        buildCommand: parsed.buildCommand || undefined,
        outputDirectory: parsed.outputDirectory || undefined,
        rootDirectory: parsed.rootDirectory || undefined,
        reasoning: parsed.reasoning || fallback.reasoning,
      };

      return normalized;
    } catch (error) {
      if (isGeminiQuotaLikeError(error)) {
        console.warn(
          `[website-hoster] Gemini quota on key #${ki + 1}/${keys.length}, trying fallback`,
        );
        continue;
      }
      console.warn("[website-hoster] AI analysis failed, using heuristics", error);
      return fallback;
    }
  }
  return fallback;
}

async function extractEntries(files: File[]): Promise<UploadedEntry[]> {
  const entries: UploadedEntry[] = [];
  let totalBytes = 0;

  for (const file of files) {
    const lower = file.name.toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("Upload too large. Limit is 100 MB.");
    }

    if (lower.endsWith(".zip")) {
      const zip = await JSZip.loadAsync(buffer);
      const zipEntries = Object.values(zip.files);
      for (const entry of zipEntries) {
        if (entry.dir) continue;
        const path = normalizePath(entry.name);
        if (!path || path.startsWith("__MACOSX/")) continue;
        const content = await entry.async("nodebuffer");
        entries.push({ path, content });
      }
      continue;
    }

    const path = normalizePath(file.name);
    if (!path) continue;
    entries.push({ path, content: buffer });
  }

  if (entries.length > MAX_FILE_COUNT) {
    throw new Error(`Too many files. Limit is ${MAX_FILE_COUNT}.`);
  }

  return entries;
}

async function tryAssignAlias(params: {
  deploymentId: string;
  requestedSlug: string;
  token: string;
  teamId?: string;
}): Promise<string | null> {
  const baseDomain = process.env.WEBSITE_HOSTER_BASE_DOMAIN || "lahaut.agency";

  const alias = `${params.requestedSlug}.${baseDomain}`.toLowerCase();
  const query = params.teamId ? `?teamId=${params.teamId}` : "";
  const aliasRes = await fetch(
    `https://api.vercel.com/v2/deployments/${params.deploymentId}/aliases${query}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ alias }),
    }
  );

  if (!aliasRes.ok) {
    const detail = await aliasRes.text();
    console.warn("[website-hoster] alias creation failed", detail);
    return null;
  }

  return `https://${alias}`;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const vercelToken = process.env.VERCEL_TOKEN;
  if (!vercelToken) {
    return NextResponse.json(
      { error: "VERCEL_TOKEN not configured" },
      { status: 500 }
    );
  }

  try {
    const formData = await request.formData();
    const siteName = String(formData.get("siteName") || "").trim();
    const uploadedFiles = formData
      .getAll("files")
      .filter((f): f is File => f instanceof File);

    if (uploadedFiles.length === 0) {
      return NextResponse.json(
        { error: "No files provided. Upload HTML/files or ZIP theme." },
        { status: 400 }
      );
    }

    const extracted = await extractEntries(uploadedFiles);
    if (extracted.length === 0) {
      return NextResponse.json(
        { error: "No usable files found in upload." },
        { status: 400 }
      );
    }

    const fallbackAnalysis = heuristicAnalysis(extracted);
    const analysis = await analyzeWithGemini(extracted, fallbackAnalysis);
    const rootApplied = analysis.rootDirectory
      ? withRoot(extracted, analysis.rootDirectory)
      : extracted;

    const hasRootIndex = rootApplied.some((f) => f.path === "index.html");
    if (!hasRootIndex && analysis.framework === null) {
      return NextResponse.json(
        {
          error:
            "Static deployment requires an index.html (or a ZIP containing it).",
        },
        { status: 400 }
      );
    }

    const vercelFiles: { file: string; data: string; encoding: "base64" }[] = rootApplied.map((file) => ({
      file: file.path,
      data: file.content.toString("base64"),
      encoding: "base64",
    }));

    const inferredName = siteName || rootApplied[0]?.path.split("/")[0] || "client-site";
    const baseSlug = slugify(inferredName) || "client-site";
    const safeName = `${baseSlug}-${Date.now().toString().slice(-6)}`;
    const teamId = process.env.VERCEL_TEAM_ID;
    const query = teamId ? `?teamId=${teamId}` : "";

    const deployBody: {
      name: string;
      files: { file: string; data: string; encoding: "base64" }[];
      target: "production";
      public: true;
      projectSettings: {
        framework: string | null;
        installCommand?: string;
        buildCommand?: string;
        outputDirectory?: string;
      };
    } = {
      name: `hosted-${safeName}`,
      files: vercelFiles,
      target: "production",
      public: true,
      projectSettings: {
        framework: analysis.framework,
      },
    };

    if (analysis.installCommand) {
      deployBody.projectSettings.installCommand = analysis.installCommand;
    }
    if (analysis.buildCommand) {
      deployBody.projectSettings.buildCommand = analysis.buildCommand;
    }
    if (analysis.outputDirectory) {
      deployBody.projectSettings.outputDirectory = analysis.outputDirectory;
    }

    const deployRes = await fetch(`https://api.vercel.com/v13/deployments${query}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(deployBody),
    });

    if (!deployRes.ok) {
      const detail = await deployRes.text();
      console.error("[website-hoster] deploy failed", detail);
      return NextResponse.json(
        { error: `Vercel deploy failed: ${deployRes.status}` },
        { status: 500 }
      );
    }

    const deployed = (await deployRes.json()) as { id: string; url: string };
    const deploymentUrl = `https://${deployed.url}`;
    const customUrl = await tryAssignAlias({
      deploymentId: deployed.id,
      requestedSlug: safeName,
      token: vercelToken,
      teamId,
    });

    return NextResponse.json({
      deploymentId: deployed.id,
      deploymentUrl,
      customUrl,
      publicUrl: customUrl || deploymentUrl,
      fileCount: rootApplied.length,
      analysis,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Deployment failed";
    console.error("[website-hoster] unexpected error", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
