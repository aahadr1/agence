"use client";

import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Stepper } from "@/components/website-maker/stepper";
import {
  ArrowRight,
  Building2,
  Camera,
  Check,
  ImagePlus,
  Loader2,
  MessageSquare,
  Palette,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const PRESET_COLORS = [
  "#1a1a2e", "#16213e", "#0f3460", "#533483",
  "#e94560", "#f38181", "#fce38a", "#eaffd0",
  "#95e1d3", "#aa96da", "#c4b7a6", "#d4a373",
  "#264653", "#2a9d8f", "#e9c46a", "#f4a261",
  "#e76f51", "#606c38", "#283618", "#dda15e",
];

export default function NewProjectPage() {
  const router = useRouter();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const photosInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [businessName, setBusinessName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [instructions, setInstructions] = useState("");

  // Color state
  const [colorMode, setColorMode] = useState<"auto" | "manual">("auto");
  const [color1, setColor1] = useState("#6d28d9");
  const [color2, setColor2] = useState("#1a1a2e");

  // Image state
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);

  // Pipeline state
  const [phase, setPhase] = useState<"input" | "processing" | "done">("input");
  const [currentStep, setCurrentStep] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const handlePhotosSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setPhotoFiles((prev) => [...prev, ...files]);
    setPhotoPreviews((prev) => [
      ...prev,
      ...files.map((f) => URL.createObjectURL(f)),
    ]);
  };

  const removePhoto = (index: number) => {
    setPhotoFiles((prev) => prev.filter((_, i) => i !== index));
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadImage = useCallback(
    async (file: File, projectId: string, type: "logo" | "photo") => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("projectId", projectId);
      formData.append("type", type);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error("Upload error:", errData);
        throw new Error(errData.error || "Upload failed");
      }

      const { url } = await res.json();
      return url;
    },
    []
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!logoFile) {
      setError("Please upload a logo");
      return;
    }
    setError("");
    setPhase("processing");

    try {
      // Step 1: Create project
      setCurrentStep("Creating project...");
      setProgress(5);

      const colors = colorMode === "manual" ? [color1, color2] : [];

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessInfo: {
            name: businessName,
            address: businessAddress,
            hours: "",
            description: "",
            socialMedia: {},
            colors: [],
            photos: [],
          },
          userColors: colors,
          userInstructions: instructions,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("Project creation failed:", res.status, text);
        let errMsg = "Failed to create project";
        try {
          const errData = JSON.parse(text);
          errMsg = errData.error || errMsg;
        } catch {}
        throw new Error(errMsg);
      }
      const { project } = await res.json();

      // Step 2: Upload images
      setCurrentStep("Uploading images...");
      setProgress(15);

      const logoUrl = await uploadImage(logoFile, project.id, "logo");
      const photoUrls: string[] = [];

      for (let i = 0; i < photoFiles.length; i++) {
        setCurrentStep(`Uploading photo ${i + 1}/${photoFiles.length}...`);
        const url = await uploadImage(photoFiles[i], project.id, "photo");
        photoUrls.push(url);
      }

      setProgress(20);

      // Step 3: Browser-based research (Google Maps + website + images)
      setCurrentStep("Researching business online...");
      setProgress(25);

      // Animate progress while the long-running browse request is active
      const progressInterval = setInterval(() => {
        setProgress((p) => Math.min(p + 1, 62));
      }, 4000);

      let browseOk = false;
      try {
        const browseRes = await fetch("/api/research/browse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: project.id,
            businessName,
            businessAddress,
          }),
        });

        clearInterval(progressInterval);

        if (!browseRes.ok) {
          const text = await browseRes.text();
          let msg = "Research failed";
          try {
            msg = JSON.parse(text).error || msg;
          } catch {}
          throw new Error(msg);
        }

        browseOk = true;
      } finally {
        clearInterval(progressInterval);
      }

      if (!browseOk) {
        throw new Error("Research failed unexpectedly");
      }

      setProgress(65);

      // Step 4: Analyze uploaded images with context
      setCurrentStep("Analyzing your uploaded images...");
      setProgress(68);

      const allImageUrls = [logoUrl, ...photoUrls];
      const analyzeRes = await fetch("/api/analyze-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          imageUrls: allImageUrls,
        }),
      });

      if (!analyzeRes.ok) {
        console.warn("Uploaded image analysis failed, continuing...");
      }

      setProgress(75);

      // Step 5: Generate concepts
      setCurrentStep("AI is designing 3 website concepts...");
      setProgress(80);

      const ideationRes = await fetch("/api/ideation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });

      if (!ideationRes.ok) {
        const text = await ideationRes.text();
        let msg = "Ideation failed";
        try { msg = JSON.parse(text).error || msg; } catch {}
        throw new Error(msg);
      }

      const ideationData = await ideationRes.json();
      const ideationPredId = ideationData.predictionId;
      if (!ideationPredId) {
        throw new Error("Ideation API did not return a prediction ID");
      }

      // Poll ideation prediction
      setCurrentStep("AI is thinking about your brand...");
      let ideationOutput: string | null = null;
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const pollRes = await fetch(`/api/predictions/${ideationPredId}`);
        if (!pollRes.ok) continue;
        const pollData = await pollRes.json();
        if (pollData.status === "succeeded") {
          ideationOutput = pollData.rawOutput;
          break;
        }
        if (pollData.status === "failed" || pollData.status === "canceled") {
          throw new Error(`Ideation failed: ${pollData.error || "unknown"}`);
        }
      }
      if (!ideationOutput) throw new Error("Ideation timed out");

      // Save concepts and create variants
      setCurrentStep("Saving design concepts...");
      const ideationSaveRes = await fetch("/api/ideation/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, rawOutput: ideationOutput }),
      });
      if (!ideationSaveRes.ok) {
        const text = await ideationSaveRes.text();
        let msg = "Failed to save concepts";
        try { msg = JSON.parse(text).error || msg; } catch {}
        throw new Error(msg);
      }

      setProgress(90);

      // Step 6: Generate images
      setCurrentStep("Generating website mockups...");

      const ideationSaveData = await ideationSaveRes.json();
      const variants = ideationSaveData.variants;
      if (!variants || !Array.isArray(variants) || variants.length === 0) {
        throw new Error("No design concepts were generated — please try again");
      }

      // Fire off all 3 image generations
      const predictionIds: { variantId: string; predictionId: string }[] = [];
      for (const variant of variants) {
        const imgRes = await fetch("/api/generate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            variantId: variant.id,
            prompt: variant.prompt,
            projectId: project.id,
          }),
        });
        if (imgRes.ok) {
          const { predictionId } = await imgRes.json();
          predictionIds.push({ variantId: variant.id, predictionId });
        }
      }

      setProgress(95);

      // Poll for completion
      setCurrentStep("Rendering website designs...");
      let allDone = false;
      while (!allDone) {
        await new Promise((r) => setTimeout(r, 3000));
        const statuses = await Promise.all(
          predictionIds.map(async ({ predictionId }) => {
            const res = await fetch(`/api/predictions/${predictionId}`);
            const data = await res.json();
            return data.status;
          })
        );
        allDone = statuses.every(
          (s) => s === "succeeded" || s === "failed" || s === "canceled"
        );
      }

      setProgress(100);
      setCurrentStep("Done!");
      setPhase("done");

      // Navigate to selection
      setTimeout(() => {
        router.push(`/website-maker/${project.id}/selection`);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPhase("input");
    }
  };

  // Processing view
  if (phase === "processing" || phase === "done") {
    return (
      <div className="animate-fade-in mx-auto max-w-2xl">
        <Stepper currentStep={phase === "done" ? 2 : 1} />

        <Panel padding="lg" className="rounded-sm">
          <div className="flex flex-col items-center py-4 text-center">
            <div className="mb-6 flex h-12 w-12 items-center justify-center border border-border bg-background">
              {phase === "done" ? (
                <Check className="h-5 w-5 text-foreground" strokeWidth={1.5} />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              )}
            </div>
            <h2 className="font-display text-xl font-medium text-foreground md:text-2xl">
              {phase === "done"
                ? "Designs are ready"
                : "Building concepts"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{currentStep}</p>

            <div className="mt-8 w-full max-w-md">
              <div className="h-px w-full overflow-hidden bg-black/[0.08]">
                <div
                  className="h-px bg-foreground transition-all duration-700 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-2 font-mono text-[10px] tabular-nums text-muted-foreground">
                {progress}%
              </p>
            </div>

            <div className="mt-10 grid w-full max-w-2xl grid-cols-3 gap-px bg-black/[0.08] md:grid-cols-5">
              {[
                { label: "Upload", threshold: 15 },
                { label: "Research", threshold: 30 },
                { label: "Analysis", threshold: 65 },
                { label: "Concepts", threshold: 80 },
                { label: "Mockups", threshold: 95 },
              ].map((step) => (
                <div
                  key={step.label}
                  className={cn(
                    "border border-border bg-card p-3 text-left transition-colors",
                    progress >= step.threshold
                      ? "bg-secondary/60"
                      : "opacity-50"
                  )}
                >
                  <div
                    className={cn(
                      "mb-2 text-[10px] font-medium uppercase tracking-[0.1em]",
                      progress >= step.threshold
                        ? "text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {progress >= step.threshold ? (
                      <Check className="mr-1 inline h-3 w-3" strokeWidth={2} />
                    ) : null}
                    {step.label}
                  </div>
                  <div className="h-px w-full overflow-hidden bg-black/[0.06]">
                    <div
                      className="h-px bg-foreground transition-all duration-500"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(
                            0,
                            ((progress - step.threshold + 15) / 15) * 100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="animate-fade-in mx-auto max-w-3xl">
      <Stepper currentStep={1} />

      <PageHeader
        eyebrow="Step one"
        title="Business & assets"
        description="The AI uses your business name and address to research online — Google reviews, competitors, brand signals — then generates three design directions. The more you add here, the sharper the result."
        className="mb-10"
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <Panel padding="md" className="rounded-sm">
          <h3 className="label-eyebrow mb-6 flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5" strokeWidth={1.25} />
            Details
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label-eyebrow mb-2 block">Business name *</label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                required
                className="input-minimal"
                placeholder="e.g. La Belle Assiette"
              />
            </div>
            <div>
              <label className="label-eyebrow mb-2 block">Address *</label>
              <input
                type="text"
                value={businessAddress}
                onChange={(e) => setBusinessAddress(e.target.value)}
                required
                className="input-minimal"
                placeholder="e.g. 42 Rue de Rivoli, Paris"
              />
            </div>
          </div>
        </Panel>

        <Panel padding="md" className="rounded-sm">
          <h3 className="label-eyebrow mb-1 flex items-center gap-2">
            <Upload className="h-3.5 w-3.5" strokeWidth={1.25} />
            Logo
          </h3>
          <p className="mb-6 text-[13px] text-muted-foreground">
            Used on the site and analysed for colour palette. SVG or high-res PNG preferred.
          </p>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            onChange={handleLogoSelect}
            className="hidden"
          />
          {logoPreview ? (
            <div className="flex items-center gap-4">
              <div className="relative h-20 w-20 overflow-hidden border border-border bg-secondary">
                <img
                  src={logoPreview}
                  alt="Logo"
                  className="h-full w-full object-contain p-1"
                />
                <button
                  type="button"
                  onClick={() => {
                    setLogoFile(null);
                    setLogoPreview(null);
                  }}
                  className="absolute -right-1 -top-1 border border-border bg-background p-1 text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {logoFile?.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {((logoFile?.size || 0) / 1024).toFixed(0)} KB
                </p>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 border border-dashed border-border bg-background p-8 transition-colors hover:border-foreground/25 hover:bg-secondary/30"
            >
              <Upload className="h-5 w-5 text-muted-foreground" strokeWidth={1.25} />
              <p className="text-sm font-medium text-foreground">
                Upload logo
              </p>
              <p className="text-xs text-muted-foreground">
                PNG, JPG, SVG
              </p>
            </button>
          )}
        </Panel>

        <Panel padding="md" className="rounded-sm">
          <h3 className="label-eyebrow mb-2 flex items-center gap-2">
            <Camera className="h-3.5 w-3.5" strokeWidth={1.25} />
            Photos
            <span className="font-sans text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
              optional
            </span>
          </h3>
          <p className="mb-5 text-[13px] text-muted-foreground">
            Interior, food, team shots, exterior — each image gives the AI more material to produce an accurate mockup. You can always add more after build.
          </p>
          <input
            ref={photosInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handlePhotosSelect}
            className="hidden"
          />

          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
            {photoPreviews.map((preview, i) => (
              <div
                key={i}
                className="relative aspect-square rounded-xl border border-border overflow-hidden bg-secondary group"
              >
                <img
                  src={preview}
                  alt={`Photo ${i + 1}`}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => photosInputRef.current?.click()}
              className="aspect-square rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 hover:border-primary/50 hover:bg-primary/5 transition-all"
            >
              <ImagePlus className="w-5 h-5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">
                Add photos
              </span>
            </button>
          </div>
        </Panel>

        {/* Color picker */}
        <Panel padding="md" className="rounded-sm">
          <h3 className="label-eyebrow mb-1 flex items-center gap-2">
            <Palette className="h-3.5 w-3.5" strokeWidth={1.25} />
            Brand colours
          </h3>
          <p className="mb-5 text-[13px] text-muted-foreground">
            Leave on auto and the AI infers a palette from your logo and research. Override manually for exact brand guidelines.
          </p>

          {/* Auto / Manual toggle */}
          <div className="mb-5 flex max-w-xs border border-border">
            <button
              type="button"
              onClick={() => setColorMode("auto")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium uppercase tracking-[0.08em] transition-colors",
                colorMode === "auto"
                  ? "bg-foreground text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Sparkles className="h-3 w-3" strokeWidth={1.25} />
              Auto
            </button>
            <button
              type="button"
              onClick={() => setColorMode("manual")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 border-l border-border py-2 px-3 text-xs font-medium uppercase tracking-[0.08em] transition-colors",
                colorMode === "manual"
                  ? "bg-foreground text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Palette className="h-3 w-3" strokeWidth={1.25} />
              Manual
            </button>
          </div>

          {colorMode === "manual" && (
            <div className="animate-fade-in space-y-4">
              {/* Color 1 */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">
                  Primary Color
                </label>
                <div className="flex items-center gap-3">
                  <div className="flex flex-wrap gap-2">
                    {PRESET_COLORS.slice(0, 10).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor1(c)}
                        className={cn(
                          "h-8 w-8 border transition-all",
                          color1 === c
                            ? "border-foreground ring-1 ring-foreground"
                            : "border-border hover:border-foreground/30"
                        )}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-2 ml-auto">
                    <div
                      className="h-10 w-10 border border-border"
                      style={{ backgroundColor: color1 }}
                    />
                    <input
                      type="color"
                      value={color1}
                      onChange={(e) => setColor1(e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer bg-transparent border-0"
                    />
                  </div>
                </div>
              </div>

              {/* Color 2 */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">
                  Secondary Color
                </label>
                <div className="flex items-center gap-3">
                  <div className="flex flex-wrap gap-2">
                    {PRESET_COLORS.slice(10, 20).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor2(c)}
                        className={cn(
                          "h-8 w-8 border transition-all",
                          color2 === c
                            ? "border-foreground ring-1 ring-foreground"
                            : "border-border hover:border-foreground/30"
                        )}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-2 ml-auto">
                    <div
                      className="w-10 h-10 rounded-xl border border-border shadow-inner"
                      style={{ backgroundColor: color2 }}
                    />
                    <input
                      type="color"
                      value={color2}
                      onChange={(e) => setColor2(e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer bg-transparent border-0"
                    />
                  </div>
                </div>
              </div>

              {/* Preview */}
              <div className="flex items-center gap-3 border border-border bg-secondary/40 p-3">
                <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                  Preview
                </span>
                <div className="flex gap-2">
                  <div
                    className="h-8 w-16"
                    style={{
                      background: `linear-gradient(135deg, ${color1}, ${color2})`,
                    }}
                  />
                  <div
                    className="h-8 w-8"
                    style={{ backgroundColor: color1 }}
                  />
                  <div
                    className="h-8 w-8"
                    style={{ backgroundColor: color2 }}
                  />
                </div>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  {color1} · {color2}
                </span>
              </div>
            </div>
          )}

          {colorMode === "auto" && (
            <p className="border border-border bg-secondary/40 p-4 text-xs leading-relaxed text-muted-foreground">
              <Sparkles className="mr-1 inline h-3 w-3" strokeWidth={1.25} />
              We infer palette from your logo and web research when you leave
              this on auto.
            </p>
          )}
        </Panel>

        <Panel padding="md" className="rounded-sm">
          <h3 className="label-eyebrow mb-2 flex items-center gap-2">
            <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.25} />
            Notes
            <span className="font-sans text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
              optional
            </span>
          </h3>
          <p className="mb-4 text-xs text-muted-foreground">
            Audience, tone, or constraints for the AI.
          </p>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={3}
            className="input-minimal resize-none"
            placeholder="e.g. Premium but approachable; young professionals…"
          />
        </Panel>

        {error ? (
          <p className="border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn-solid w-full py-3.5">
          <Sparkles className="h-4 w-4" strokeWidth={1.25} />
          Generate concepts
          <ArrowRight className="h-4 w-4" strokeWidth={1.25} />
        </button>
      </form>
    </div>
  );
}
