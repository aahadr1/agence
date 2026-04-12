"use client";

import { Panel } from "@/components/ui/panel";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function PublicBookPage() {
  const params = useParams();
  const slug = params.slug as string;
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(30);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/public/book/${slug}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Lien invalide");
        setTitle(data.title || "Réserver");
        setDuration(data.durationMinutes || 30);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erreur");
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startsAt) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/public/book/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestName,
          guestEmail,
          starts_at: new Date(startsAt).toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Échec");
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-muted-foreground">
        Chargement…
      </div>
    );
  }

  if (err && !title) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-destructive">
        {err}
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Panel className="p-8 text-center">
          <p className="text-sm font-medium text-foreground">Demande enregistrée</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Vous recevrez une confirmation de l&apos;agence.
          </p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="btn-solid mt-6"
          >
            Fermer
          </button>
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="font-display text-xl font-medium text-foreground">
        {title}
      </h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Créneau de {duration} minutes
      </p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <div>
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Nom
          </label>
          <input
            className="mt-1 w-full border border-border bg-card px-3 py-2 text-sm"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
          />
        </div>
        <div>
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Email
          </label>
          <input
            type="email"
            className="mt-1 w-full border border-border bg-card px-3 py-2 text-sm"
            value={guestEmail}
            onChange={(e) => setGuestEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Date et heure
          </label>
          <input
            type="datetime-local"
            required
            className="mt-1 w-full border border-border bg-card px-3 py-2 text-sm"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <button
          type="submit"
          disabled={saving}
          className="btn-solid w-full disabled:opacity-50"
        >
          {saving ? "Envoi…" : "Confirmer"}
        </button>
      </form>
    </div>
  );
}
