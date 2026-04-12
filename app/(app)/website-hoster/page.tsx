"use client";

import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import {
  CheckCircle2,
  ExternalLink,
  FileArchive,
  FileCode2,
  Globe,
  Loader2,
  Rocket,
  Upload,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type DeployResponse = {
  deploymentId: string;
  deploymentUrl: string;
  customUrl?: string | null;
  publicUrl: string;
  fileCount: number;
  analysis: {
    framework: string | null;
    installCommand?: string;
    buildCommand?: string;
    outputDirectory?: string;
    rootDirectory?: string;
    reasoning: string;
  };
};

export default function WebsiteHosterPage() {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [siteName, setSiteName] = useState("");
  const [files, setFiles] = useState<Array<{ file: File; path: string }>>([]);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeployResponse | null>(null);

  useEffect(() => {
    const input = folderInputRef.current;
    if (!input) return;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  }, []);

  const counts = useMemo(() => {
    let zip = 0;
    let other = 0;
    for (const entry of files) {
      if (entry.path.toLowerCase().endsWith(".zip")) zip += 1;
      else other += 1;
    }
    return { zip, other };
  }, [files]);

  const onSelectFiles = (nextFiles: FileList | null) => {
    if (!nextFiles) return;
    const mapped = Array.from(nextFiles).map((file) => ({
      file,
      path: file.webkitRelativePath || file.name,
    }));
    setFiles((prev) => [...prev, ...mapped]);
  };

  const reset = () => {
    setFiles([]);
    setError(null);
    setResult(null);
  };

  const deploy = async () => {
    if (files.length === 0) {
      setError("Ajoute au moins un fichier HTML/ZIP avant le deploy.");
      return;
    }

    setDeploying(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      if (siteName.trim()) formData.append("siteName", siteName.trim());
      for (const entry of files) {
        formData.append("files", entry.file, entry.path);
      }

      const res = await fetch("/api/website-hoster/deploy", {
        method: "POST",
        body: formData,
      });

      const data = (await res.json()) as DeployResponse | { error?: string };
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || "Deploy failed");
      }

      setResult(data as DeployResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deploy failed");
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Website hoster"
        title="Host Any Website"
        description="Upload ton code (index.html, assets, ZIP theme, etc). L'IA analyse la stack, configure Vercel, puis publie un lien partageable client."
      />

      <div className="grid gap-6 border-t border-border pt-10 md:grid-cols-5">
        <Panel padding="md" className="rounded-sm md:col-span-3">
          <h2 className="mb-5 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Upload className="h-4 w-4" />
            Upload
          </h2>

          <div className="space-y-4">
            <div>
              <label className="label-eyebrow mb-2 block">Nom du site (optionnel)</label>
              <input
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                className="input-minimal"
                placeholder="ex: demo-client-paris"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center justify-center gap-2 border border-dashed border-border bg-background px-4 py-5 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground">
                <FileCode2 className="h-4 w-4" />
                Ajouter fichiers/code
                <input
                  type="file"
                  multiple
                  onChange={(e) => onSelectFiles(e.target.files)}
                  className="hidden"
                />
              </label>

              <label className="flex cursor-pointer items-center justify-center gap-2 border border-dashed border-border bg-background px-4 py-5 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground">
                <FileArchive className="h-4 w-4" />
                Ajouter ZIP theme
                <input
                  type="file"
                  accept=".zip,application/zip"
                  multiple
                  onChange={(e) => onSelectFiles(e.target.files)}
                  className="hidden"
                />
              </label>
            </div>
            <button
              type="button"
              className="w-full border border-dashed border-border bg-background px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
              onClick={() => folderInputRef.current?.click()}
            >
              Ajouter dossier complet (structure preservee)
            </button>
            <input
              ref={folderInputRef}
              type="file"
              multiple
              onChange={(e) => onSelectFiles(e.target.files)}
              className="hidden"
            />

            <div className="border border-border bg-secondary/30 p-4">
              <p className="mb-2 text-xs text-muted-foreground">
                {files.length} fichier(s) sélectionné(s) - {counts.other} fichier(s) standard, {counts.zip} ZIP
              </p>
              <div className="max-h-44 space-y-1 overflow-auto font-mono text-[11px]">
                {files.length === 0 ? (
                  <p className="text-muted-foreground">Aucun fichier.</p>
                ) : (
                  files.map((entry, index) => (
                    <p key={`${entry.path}-${index}`} className="truncate text-foreground/90">
                      {entry.path}
                    </p>
                  ))
                )}
              </div>
            </div>

            {error ? (
              <div className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-solid"
                onClick={deploy}
                disabled={deploying}
              >
                {deploying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Rocket className="h-4 w-4" />
                )}
                {deploying ? "Analyse + deploy..." : "Analyser et deployer"}
              </button>

              <button
                type="button"
                className="btn-outline"
                onClick={reset}
                disabled={deploying}
              >
                Reset
              </button>
            </div>
          </div>
        </Panel>

        <Panel padding="md" className="rounded-sm md:col-span-2">
          <h2 className="mb-5 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Globe className="h-4 w-4" />
            Deploy Result
          </h2>

          {!result ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>1. Upload du code client</p>
              <p>2. Analyse automatique stack + settings Vercel</p>
              <p>3. Deployment et lien partageable</p>
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="flex items-start gap-2 border border-emerald-500/30 bg-emerald-500/5 p-3 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                Site deploye avec succes.
              </div>

              <div className="space-y-2">
                <p className="label-eyebrow">Lien public</p>
                <a
                  href={result.publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
                >
                  {result.publicUrl}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>

              {result.customUrl ? (
                <p className="text-xs text-muted-foreground">
                  URL custom appliquee sur ton domaine.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  URL Vercel utilisee (fallback). Par defaut, on tente une URL `*.lahaut.agency`.
                </p>
              )}

              <div className="space-y-2 border-t border-border pt-4">
                <p className="label-eyebrow">Analyse IA</p>
                <p className="text-xs text-muted-foreground">{result.analysis.reasoning}</p>
                <div className="grid grid-cols-1 gap-2 font-mono text-[11px] text-foreground/90">
                  <p>framework: {result.analysis.framework || "static/null"}</p>
                  <p>install: {result.analysis.installCommand || "auto"}</p>
                  <p>build: {result.analysis.buildCommand || "none"}</p>
                  <p>output: {result.analysis.outputDirectory || "none"}</p>
                  <p>root: {result.analysis.rootDirectory || "root"}</p>
                  <p>files: {result.fileCount}</p>
                </div>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
