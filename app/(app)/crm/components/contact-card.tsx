"use client";

import type { CrmContact } from "@/lib/crm/types";
import { User, Phone, Mail, Linkedin, Briefcase } from "lucide-react";

function InfoRow({ icon, label, value, href }: { icon: React.ReactNode; label: string; value: string | null; href?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="mt-0.5 text-muted-foreground/60">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground">{label}</p>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs text-blue hover:underline break-all">
            {value}
          </a>
        ) : (
          <p className="text-xs text-foreground break-all">{value}</p>
        )}
      </div>
    </div>
  );
}

export function ContactCard({ contact }: { contact: CrmContact | null }) {
  if (!contact) {
    return (
      <div className="rounded-[var(--radius)] border border-border bg-card p-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Contact</h3>
        <p className="mt-2 text-xs text-muted-foreground">No contact linked yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius)] border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <User className="h-3.5 w-3.5" />
        </div>
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Contact</h3>
          <p className="text-sm font-medium text-foreground">{contact.full_name}</p>
        </div>
      </div>
      <div className="mt-3 space-y-0">
        <InfoRow icon={<Briefcase className="h-3 w-3" />} label="Role" value={contact.role} />
        <InfoRow icon={<Phone className="h-3 w-3" />} label="Phone" value={contact.phone} href={contact.phone ? `tel:${contact.phone}` : undefined} />
        <InfoRow icon={<Mail className="h-3 w-3" />} label="Email" value={contact.email} href={contact.email ? `mailto:${contact.email}` : undefined} />
        <InfoRow icon={<Linkedin className="h-3 w-3" />} label="LinkedIn" value={contact.linkedin_url} href={contact.linkedin_url ?? undefined} />
      </div>
    </div>
  );
}
