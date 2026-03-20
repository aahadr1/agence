"use client";

import { createClient } from "@/lib/supabase/client";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  const supabase = createClient();

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/dashboard");
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      setError(error.message);
    } else {
      setMessage("Check your email for the login link.");
    }
    setLoading(false);
  };

  return (
    <div className="animate-fade-in w-full">
      <header className="mb-10 border-b border-border pb-8">
        <p className="label-eyebrow mb-3">Access</p>
        <h1 className="font-display text-3xl font-medium tracking-tight text-foreground md:text-4xl">
          Welcome back
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          Sign in to reach your Website Maker projects and Lead Generator searches.
        </p>
      </header>

      <Panel padding="md" className="rounded-sm">
        <div className="mb-8 flex border-b border-border">
          <button
            type="button"
            onClick={() => setMode("password")}
            className={cn(
              "relative flex-1 border-b-2 py-3 text-xs font-medium uppercase tracking-[0.12em] transition-colors",
              mode === "password"
                ? "-mb-px border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Password
          </button>
          <button
            type="button"
            onClick={() => setMode("magic")}
            className={cn(
              "relative flex-1 border-b-2 py-3 text-xs font-medium uppercase tracking-[0.12em] transition-colors",
              mode === "magic"
                ? "-mb-px border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Magic link
          </button>
        </div>

        <form
          onSubmit={mode === "password" ? handlePasswordLogin : handleMagicLink}
          className="space-y-5"
        >
          <div>
            <label className="label-eyebrow mb-2 block">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input-minimal"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>

          {mode === "password" && (
            <div>
              <label className="label-eyebrow mb-2 block">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="input-minimal"
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
          )}

          {error ? (
            <p className="border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {message ? (
            <p className="border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground">
              {message}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="btn-solid w-full"
          >
            {loading
              ? "Please wait…"
              : mode === "password"
                ? "Sign in"
                : "Send link"}
          </button>
        </form>

        <p className="mt-8 border-t border-border pt-8 text-center text-sm text-muted-foreground">
          No account?{" "}
          <Link
            href="/signup"
            className="font-medium text-foreground underline underline-offset-4 hover:no-underline"
          >
            Create one
          </Link>
        </p>
      </Panel>
    </div>
  );
}
