"use client";

import { useEffect, useState } from "react";
import {
  Link as LinkIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  Mail,
  Calendar,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface Connection {
  id: string;
  provider: string;
  account_email: string | null;
  scopes: string[];
  updated_at: string;
}

export default function ConnectionsPage() {
  const supabase = createClient();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("user_connections")
      .select("id, provider, account_email, scopes, updated_at")
      .order("updated_at", { ascending: false });
    setConnections(data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // Refresh when redirected back from OAuth
    const url = new URL(window.location.href);
    if (url.searchParams.get("google_connected")) {
      url.searchParams.delete("google_connected");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const connectGoogle = () => {
    window.location.href = `/api/integrations/google/start?returnTo=${encodeURIComponent(
      "/settings/connections",
    )}`;
  };

  const disconnectGoogle = async () => {
    if (!confirm("Déconnecter le compte Google ? L'agent perdra l'accès à Gmail et Calendar."))
      return;
    setDisconnecting(true);
    await fetch("/api/integrations/google/disconnect", { method: "POST" });
    await load();
    setDisconnecting(false);
  };

  const google = connections.find((c) => c.provider === "google");

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-lg font-semibold">Connexions</h1>
      <p className="mb-6 text-xs text-muted-foreground">
        Autorisez l&apos;agent à agir en votre nom sur vos comptes. Les jetons
        sont chiffrés en base ; vous pouvez révoquer à tout moment.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement...
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10">
                  <Mail className="h-5 w-5 text-red-500" strokeWidth={1.5} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">Google Workspace</h2>
                  <p className="text-xs text-muted-foreground">
                    Gmail (lecture/envoi) + Google Calendar (lecture/création)
                  </p>
                  {google ? (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px]">
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      <span className="font-mono text-foreground">
                        {google.account_email}
                      </span>
                      <span className="text-muted-foreground">
                        — {google.scopes.length} scopes
                      </span>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-600">
                      <AlertCircle className="h-3 w-3" />
                      Non connecté
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {google ? (
                  <button
                    onClick={disconnectGoogle}
                    disabled={disconnecting}
                    className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
                  >
                    {disconnecting ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                    Déconnecter
                  </button>
                ) : (
                  <button
                    onClick={connectGoogle}
                    className="flex items-center gap-1.5 rounded bg-blue-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-600"
                  >
                    <LinkIcon className="h-3 w-3" />
                    Connecter Google
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span>Plus d&apos;intégrations à venir (Slack, Notion, GitHub)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
