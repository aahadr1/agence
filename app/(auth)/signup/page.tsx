"use client";

import { createClient } from "@/lib/supabase/client";
import { Panel } from "@/components/ui/panel";
import Link from "next/link";
import { useState } from "react";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
    } else {
      setMessage("Check your email to confirm your account.");
    }
    setLoading(false);
  };

  return (
    <div className="animate-fade-in w-full">
      <header className="mb-10 border-b border-border pb-8">
        <p className="label-eyebrow mb-3">Get started</p>
        <h1 className="font-display text-3xl font-medium tracking-tight text-foreground md:text-4xl">
          Create your account
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          One account unlocks both tools — build AI-generated websites for any business,
          or prospect for clients who need one.
        </p>
      </header>

      <Panel padding="md" className="rounded-sm">
        <form onSubmit={handleSignup} className="space-y-5">
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

          <div>
            <label className="label-eyebrow mb-2 block">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="input-minimal"
              placeholder="At least 6 characters"
              autoComplete="new-password"
            />
          </div>

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

          <button type="submit" disabled={loading} className="btn-solid w-full">
            {loading ? "Creating…" : "Create account"}
          </button>
        </form>

        <p className="mt-8 border-t border-border pt-8 text-center text-sm text-muted-foreground">
          Already registered?{" "}
          <Link
            href="/login"
            className="font-medium text-foreground underline underline-offset-4 hover:no-underline"
          >
            Sign in
          </Link>
        </p>
      </Panel>
    </div>
  );
}
