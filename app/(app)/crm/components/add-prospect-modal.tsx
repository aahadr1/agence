"use client";

import type { CrmStage } from "@/lib/crm/types";
import { X } from "lucide-react";
import { useState } from "react";

type FormData = {
  title: string;
  description: string;
  stage_id: string;
  amount: string;
  probability: string;
  expected_close_date: string;
  source: string;
  account_name: string;
  account_email: string;
  account_phone: string;
  account_website: string;
  contact_name: string;
  contact_role: string;
  contact_email: string;
  contact_phone: string;
  contact_linkedin: string;
};

const EMPTY: FormData = {
  title: "",
  description: "",
  stage_id: "",
  amount: "",
  probability: "",
  expected_close_date: "",
  source: "manual",
  account_name: "",
  account_email: "",
  account_phone: "",
  account_website: "",
  contact_name: "",
  contact_role: "",
  contact_email: "",
  contact_phone: "",
  contact_linkedin: "",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function AddProspectModal({
  open,
  onClose,
  onCreated,
  stages,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  stages: CrmStage[];
}) {
  const [form, setForm] = useState<FormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (key: keyof FormData, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/crm/v2/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || null,
          stage_id: form.stage_id || undefined,
          amount_cents: form.amount ? Math.round(parseFloat(form.amount) * 100) : 0,
          probability: form.probability ? parseInt(form.probability) : 0,
          expected_close_date: form.expected_close_date || null,
          source: form.source,
          account_name: form.account_name.trim() || undefined,
          account_email: form.account_email.trim() || undefined,
          account_phone: form.account_phone.trim() || undefined,
          account_website: form.account_website.trim() || undefined,
          contact_name: form.contact_name.trim() || undefined,
          contact_role: form.contact_role.trim() || undefined,
          contact_email: form.contact_email.trim() || undefined,
          contact_phone: form.contact_phone.trim() || undefined,
          contact_linkedin: form.contact_linkedin.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create prospect");
      }
      setForm(EMPTY);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create prospect");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto pt-16 pb-10">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-[var(--radius)] border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold text-foreground">New prospect</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5 p-5">
          {error && (
            <p className="rounded bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
          )}

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Prospect</p>
            <Field label="Name *">
              <input type="text" value={form.title} onChange={(e) => set("title", e.target.value)} className="input-minimal py-1.5 text-sm" placeholder="e.g. Website redesign for Acme" />
            </Field>
            <Field label="Description">
              <textarea value={form.description} onChange={(e) => set("description", e.target.value)} className="input-minimal py-1.5 text-sm" rows={2} placeholder="Brief description..." />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Stage">
                <select value={form.stage_id} onChange={(e) => set("stage_id", e.target.value)} className="input-minimal py-1.5 text-sm">
                  <option value="">First stage</option>
                  {stages.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                </select>
              </Field>
              <Field label="Source">
                <select value={form.source} onChange={(e) => set("source", e.target.value)} className="input-minimal py-1.5 text-sm">
                  <option value="manual">Manual</option>
                  <option value="lead_generator">Lead Generator</option>
                  <option value="referral">Referral</option>
                  <option value="inbound">Inbound</option>
                  <option value="outbound">Outbound</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Amount (EUR)">
                <input type="number" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} className="input-minimal py-1.5 text-sm" placeholder="0.00" />
              </Field>
              <Field label="Probability (%)">
                <input type="number" min="0" max="100" value={form.probability} onChange={(e) => set("probability", e.target.value)} className="input-minimal py-1.5 text-sm" placeholder="0" />
              </Field>
              <Field label="Close date">
                <input type="date" value={form.expected_close_date} onChange={(e) => set("expected_close_date", e.target.value)} className="input-minimal py-1.5 text-sm" />
              </Field>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Company</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Company name">
                <input type="text" value={form.account_name} onChange={(e) => set("account_name", e.target.value)} className="input-minimal py-1.5 text-sm" />
              </Field>
              <Field label="Website">
                <input type="url" value={form.account_website} onChange={(e) => set("account_website", e.target.value)} className="input-minimal py-1.5 text-sm" />
              </Field>
              <Field label="Email">
                <input type="email" value={form.account_email} onChange={(e) => set("account_email", e.target.value)} className="input-minimal py-1.5 text-sm" />
              </Field>
              <Field label="Phone">
                <input type="tel" value={form.account_phone} onChange={(e) => set("account_phone", e.target.value)} className="input-minimal py-1.5 text-sm" />
              </Field>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Contact</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Full name">
                <input type="text" value={form.contact_name} onChange={(e) => set("contact_name", e.target.value)} className="input-minimal py-1.5 text-sm" />
              </Field>
              <Field label="Role">
                <input type="text" value={form.contact_role} onChange={(e) => set("contact_role", e.target.value)} className="input-minimal py-1.5 text-sm" />
              </Field>
              <Field label="Email">
                <input type="email" value={form.contact_email} onChange={(e) => set("contact_email", e.target.value)} className="input-minimal py-1.5 text-sm" />
              </Field>
              <Field label="Phone">
                <input type="tel" value={form.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} className="input-minimal py-1.5 text-sm" />
              </Field>
            </div>
            <Field label="LinkedIn">
              <input type="url" value={form.contact_linkedin} onChange={(e) => set("contact_linkedin", e.target.value)} className="input-minimal py-1.5 text-sm" />
            </Field>
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} className="btn-outline text-xs">Cancel</button>
            <button type="submit" disabled={saving} className="btn-solid text-xs">{saving ? "Creating..." : "Create prospect"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
