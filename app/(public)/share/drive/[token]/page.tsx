"use client";

import { SimpleEditor } from "@/components/drive/simple-editor";
import { Panel } from "@/components/ui/panel";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function PublicDriveSharePage() {
  const params = useParams();
  const token = params.token as string;
  const [title, setTitle] = useState("");
  const [content, setContent] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/public/drive/${token}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Erreur");
        setTitle(data.node.title);
        setContent(data.node.content);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erreur");
      }
    })();
  }, [token]);

  if (err) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-sm text-destructive">
        {err}
      </div>
    );
  }

  if (!content && !err) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-sm text-muted-foreground">
        Chargement…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-display text-xl font-medium text-foreground">
        {title}
      </h1>
      <p className="mt-1 text-xs text-muted-foreground">Lecture seule</p>
      <Panel className="mt-6 p-4">
        <SimpleEditor
          readOnly
          initialContent={content}
          onSave={() => {}}
        />
      </Panel>
    </div>
  );
}
