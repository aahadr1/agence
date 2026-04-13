"use client";

import { Lead } from "@/lib/types";
import {
  X,
  Phone,
  Mail,
  MapPin,
  Globe,
  Star,
  User,
  Building2,
  Hash,
  CalendarDays,
  Users,
  Facebook,
  Instagram,
  Linkedin,
  Shield,
  CalendarCheck,
  MessageCircle,
  Megaphone,
  KanbanSquare,
  Loader2,
  Copy,
  CheckCheck,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface RelatedContact {
  name: string;
  title: string | null;
  linkedin_url: string | null;
}

interface LeadDrawerProps {
  lead: Lead | null;
  onClose: () => void;
  onAddToPipeline?: (leadId: string) => void;
  addingToPipeline?: boolean;
  onGenerateOutreach?: (leadId: string) => void;
  generatingOutreach?: boolean;
  /** Message après action CRM (succès / erreur) */
  pipelineFeedback?: string | null;
  /** Create a new lead from a related LinkedIn contact */
  onCreateLeadFromContact?: (parentLeadId: string, contact: RelatedContact) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const color =
    score >= 70
      ? "text-green-500 border-green-500/30 bg-green-500/10"
      : score >= 40
        ? "text-amber-500 border-amber-500/30 bg-amber-500/10"
        : "text-muted-foreground border-border bg-secondary/40";

  return (
    <span
      className={`inline-flex items-center gap-1 border px-2.5 py-1 text-sm font-semibold tabular-nums ${color}`}
    >
      <TrendingUp className="h-3.5 w-3.5" strokeWidth={1.5} />
      {score}/100
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="label-eyebrow mb-3 flex items-center gap-1.5 text-[10px]">
      {children}
    </h3>
  );
}

function Row({
  label,
  value,
  href,
  tel,
  copy,
}: {
  label: string;
  value: string | null | undefined;
  href?: string;
  tel?: string;
  copy?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const content = href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline-offset-4 hover:underline"
    >
      {value}
    </a>
  ) : tel ? (
    <a href={`tel:${tel}`} className="text-primary underline-offset-4 hover:underline">
      {value}
    </a>
  ) : (
    <span className="text-foreground">{value}</span>
  );

  return (
    <div className="flex items-start justify-between gap-2 py-1.5 border-b border-border/50 last:border-0">
      <span className="text-[11px] text-muted-foreground shrink-0 w-28">{label}</span>
      <span className="text-[11px] flex-1 text-right">{content}</span>
      {copy && value && (
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? (
            <CheckCheck className="h-3 w-3 text-green-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      )}
    </div>
  );
}

function DigitalPill({
  label,
  ok,
  icon: Icon,
}: {
  label: string;
  ok: boolean | null;
  icon: React.ElementType;
}) {
  if (ok === null) return null;
  return (
    <div
      className={`flex items-center gap-2 py-1.5 border-b border-border/50 last:border-0`}
    >
      <Icon
        className={`h-3.5 w-3.5 shrink-0 ${ok ? "text-green-500" : "text-red-400"}`}
        strokeWidth={1.5}
      />
      <span className="text-[11px] flex-1 text-foreground">{label}</span>
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" strokeWidth={1.5} />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5 text-red-400" strokeWidth={1.5} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LeadDrawer({
  lead,
  onClose,
  onAddToPipeline,
  addingToPipeline,
  onGenerateOutreach,
  generatingOutreach,
  pipelineFeedback,
  onCreateLeadFromContact,
}: LeadDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const [noteText, setNoteText] = useState("");

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    if (lead) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [lead]);

  if (!lead) return null;

  const salesBrief =
    typeof lead.enrichment_data?.sales_brief === "string"
      ? lead.enrichment_data.sales_brief
      : null;

  const nafCode =
    typeof lead.enrichment_data?.naf_code === "string"
      ? lead.enrichment_data.naf_code
      : null;

  const capital =
    typeof lead.enrichment_data?.capital === "string"
      ? lead.enrichment_data.capital
      : null;

  const linkedinHeadline =
    typeof lead.enrichment_data?.linkedin_headline === "string"
      ? lead.enrichment_data.linkedin_headline
      : null;

  const relatedContacts: RelatedContact[] = Array.isArray(lead.enrichment_data?.related_contacts)
    ? (lead.enrichment_data.related_contacts as RelatedContact[])
    : [];

  const rating = parseFloat(lead.rating || "0");
  const reviews = parseInt(lead.review_count || "0", 10);

  // Build address from best available source
  const displayAddress = lead.address || null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-2xl"
        style={{ animation: "slideInRight 0.2s ease-out" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h2 className="text-base font-semibold text-foreground leading-tight">
                {lead.business_name}
              </h2>
              {lead.potential_score !== null && (
                <ScoreBadge score={lead.potential_score} />
              )}
            </div>
            {displayAddress && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <MapPin className="h-3 w-3 shrink-0" />
                {displayAddress}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 border border-border p-1.5 text-muted-foreground hover:bg-secondary/50 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-0 divide-y divide-border">

            {/* ── INTERLOCUTEUR ── */}
            <div className="p-5">
              <SectionTitle>
                <User className="h-3 w-3" strokeWidth={1.5} />
                Interlocuteur
              </SectionTitle>
              {lead.owner_name ? (
                <div className="space-y-0">
                  <Row
                    label="Nom"
                    value={
                      lead.owner_name +
                      (lead.owner_role ? ` — ${lead.owner_role}` : "")
                    }
                    copy
                  />
                  <Row
                    label="Tél. perso"
                    value={lead.owner_phone}
                    tel={lead.owner_phone || undefined}
                    copy
                  />
                  <Row
                    label="Email perso"
                    value={lead.owner_email}
                    href={lead.owner_email ? `mailto:${lead.owner_email}` : undefined}
                    copy
                  />
                  {lead.linkedin_url && (
                    <div className="flex items-start justify-between gap-2 py-1.5 border-b border-border/50">
                      <span className="text-[11px] text-muted-foreground shrink-0 w-28">LinkedIn</span>
                      <div className="flex-1 text-right">
                        <a
                          href={lead.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full bg-[#0A66C2]/10 px-2.5 py-1 text-[11px] font-medium text-[#0A66C2] hover:bg-[#0A66C2]/20 transition-colors"
                        >
                          <Linkedin className="h-3.5 w-3.5" />
                          Voir profil
                        </a>
                      </div>
                    </div>
                  )}
                  {linkedinHeadline && (
                    <Row label="Titre LinkedIn" value={linkedinHeadline} />
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Dirigeant non identifié — enregistrez PAPPERS_API_KEY pour
                  obtenir le nom du dirigeant automatiquement.
                </p>
              )}
            </div>

            {/* ── CONTACTS ASSOCIÉS (LinkedIn) ── */}
            {relatedContacts.length > 0 && (
              <div className="p-5">
                <SectionTitle>
                  <Users className="h-3 w-3" strokeWidth={1.5} />
                  Contacts associés
                </SectionTitle>
                <div className="space-y-2">
                  {relatedContacts.map((contact, i) => (
                    <div
                      key={`${contact.name}-${i}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium text-foreground truncate">
                          {contact.name}
                        </p>
                        {contact.title && (
                          <p className="text-[10px] text-muted-foreground truncate">
                            {contact.title}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {contact.linkedin_url && (
                          <a
                            href={contact.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#0A66C2] hover:text-[#0A66C2]/80 transition-colors"
                          >
                            <Linkedin className="h-3.5 w-3.5" />
                          </a>
                        )}
                        {onCreateLeadFromContact && (
                          <button
                            type="button"
                            onClick={() => onCreateLeadFromContact(lead.id, contact)}
                            className="text-[10px] font-medium px-2 py-0.5 border border-border rounded hover:bg-accent transition-colors"
                          >
                            + Lead
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── CONTACT ENTREPRISE ── */}
            <div className="p-5">
              <SectionTitle>
                <Phone className="h-3 w-3" strokeWidth={1.5} />
                Contact entreprise
              </SectionTitle>
              <div className="space-y-0">
                <Row
                  label="Téléphone"
                  value={lead.phone}
                  tel={lead.phone || undefined}
                  copy
                />
                <Row
                  label="Email"
                  value={lead.email}
                  href={lead.email ? `mailto:${lead.email}` : undefined}
                  copy
                />
                <Row
                  label="Site web"
                  value={lead.website_url}
                  href={lead.website_url || undefined}
                />
                {rating > 0 && (
                  <div className="flex items-start justify-between gap-2 py-1.5 border-b border-border/50">
                    <span className="text-[11px] text-muted-foreground shrink-0 w-28">
                      Note Google
                    </span>
                    <span className="text-[11px] flex-1 text-right text-foreground flex items-center justify-end gap-1">
                      <Star className="h-3 w-3 text-amber-500" strokeWidth={1.5} />
                      {rating}/5
                      {reviews > 0 && (
                        <span className="text-muted-foreground">({reviews} avis)</span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* ── FICHE ENTREPRISE ── */}
            <div className="p-5">
              <SectionTitle>
                <Building2 className="h-3 w-3" strokeWidth={1.5} />
                Fiche entreprise
              </SectionTitle>
              <div className="space-y-0">
                <Row label="Forme" value={lead.company_type} />
                <Row
                  label="Créée en"
                  value={
                    lead.creation_date
                      ? lead.creation_date.slice(0, 4)
                      : null
                  }
                />
                <Row label="Salariés" value={lead.employee_count} />
                <Row label="CA estimé" value={lead.revenue_bracket} />
                <Row label="SIREN" value={lead.siren} copy />
                <Row label="Capital" value={capital} />
                <Row label="Code NAF" value={nafCode} />
              </div>
            </div>

            {/* ── AUDIT DIGITAL ── */}
            <div className="p-5">
              <SectionTitle>
                <Globe className="h-3 w-3" strokeWidth={1.5} />
                Audit digital
              </SectionTitle>

              {/* Website quality */}
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">Site web</span>
                {!lead.has_website || lead.website_quality === "none" ? (
                  <span className="text-[11px] font-medium text-red-400">Absent</span>
                ) : (
                  <span
                    className={`text-[11px] font-medium ${
                      lead.website_quality === "good"
                        ? "text-green-500"
                        : lead.website_quality === "decent"
                          ? "text-amber-500"
                          : "text-red-400"
                    }`}
                  >
                    {lead.website_quality === "dead" && "Hors ligne"}
                    {lead.website_quality === "outdated" && "Obsolète"}
                    {lead.website_quality === "poor" && "Faible"}
                    {lead.website_quality === "decent" && "Correct"}
                    {lead.website_quality === "good" && "Bon"}
                    {lead.website_score != null &&
                      ` (${lead.website_score}/100)`}
                  </span>
                )}
              </div>

              <div className="space-y-0">
                <DigitalPill
                  label="HTTPS / Sécurisé"
                  ok={lead.has_https}
                  icon={Shield}
                />
                <DigitalPill
                  label="Réservation en ligne"
                  ok={lead.has_booking}
                  icon={CalendarCheck}
                />
                <DigitalPill
                  label="Chat / Chatbot"
                  ok={lead.has_chatbot}
                  icon={MessageCircle}
                />
                <DigitalPill
                  label={
                    lead.has_meta_ads && lead.meta_ads_count
                      ? `Publicités Meta (${lead.meta_ads_count})`
                      : "Publicités Meta"
                  }
                  ok={lead.has_meta_ads}
                  icon={Megaphone}
                />
              </div>

              {/* Social presence */}
              <div className="mt-3 flex flex-wrap gap-2">
                {lead.google_maps_url && (
                  <a
                    href={lead.google_maps_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 border border-border text-muted-foreground hover:border-foreground/25 transition-colors"
                  >
                    <MapPin className="w-3 h-3" /> Maps
                  </a>
                )}
                {lead.facebook_url && (
                  <a
                    href={lead.facebook_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 border border-zinc-500/20 bg-zinc-500/5 text-zinc-600 hover:bg-zinc-500/10 dark:text-zinc-400 transition-colors"
                  >
                    <Facebook className="w-3 h-3" />
                    Facebook
                    {lead.follower_count
                      ? ` (${lead.follower_count.toLocaleString("fr-FR")})`
                      : ""}
                  </a>
                )}
                {lead.instagram_url && (
                  <a
                    href={lead.instagram_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 border border-pink-500/20 bg-pink-500/5 text-pink-400 hover:bg-pink-500/10 transition-colors"
                  >
                    <Instagram className="w-3 h-3" /> Instagram
                  </a>
                )}
                {lead.linkedin_url && (
                  <a
                    href={lead.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 border border-zinc-600/20 bg-zinc-600/5 text-zinc-700 hover:bg-zinc-600/10 dark:text-zinc-300 transition-colors"
                  >
                    <Linkedin className="w-3 h-3" /> LinkedIn
                  </a>
                )}
              </div>
            </div>

            {/* ── ANGLE D'APPEL ── */}
            {salesBrief && (
              <div className="p-5">
                <SectionTitle>
                  <Sparkles className="h-3 w-3" strokeWidth={1.5} />
                  Angle d&apos;appel
                </SectionTitle>
                <p className="text-[12px] text-foreground leading-relaxed border-l-2 border-primary/30 pl-3 italic">
                  {salesBrief}
                </p>
              </div>
            )}

            {/* ── NOTES ── */}
            <div className="p-5">
              <SectionTitle>
                <Hash className="h-3 w-3" strokeWidth={1.5} />
                Notes
              </SectionTitle>
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Ajouter une note sur ce prospect..."
                rows={3}
                className="w-full resize-none border border-border bg-secondary/20 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground/30 transition-colors"
              />
            </div>

          </div>
        </div>

        {/* Footer actions */}
        {pipelineFeedback ? (
          <p className="border-t border-border px-4 py-2 text-center text-[11px] text-muted-foreground">
            {pipelineFeedback}
          </p>
        ) : null}
        <div className="flex items-center gap-2 border-t border-border p-4">
          {lead.phone && (
            <a
              href={`tel:${lead.phone}`}
              className="flex flex-1 items-center justify-center gap-1.5 border border-border py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-foreground hover:bg-secondary/50 transition-colors"
            >
              <Phone className="h-3.5 w-3.5" strokeWidth={1.5} />
              Appeler
            </a>
          )}
          {onGenerateOutreach && (
            <button
              type="button"
              disabled={generatingOutreach}
              onClick={() => onGenerateOutreach(lead.id)}
              className="flex flex-1 items-center justify-center gap-1.5 border border-border py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-foreground hover:bg-secondary/50 disabled:opacity-50 transition-colors"
            >
              {generatingOutreach ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Mail className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
              Outreach
            </button>
          )}
          {onAddToPipeline && (
            <button
              type="button"
              disabled={addingToPipeline}
              onClick={() => onAddToPipeline(lead.id)}
              className="flex flex-1 items-center justify-center gap-1.5 border border-border py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-foreground hover:bg-secondary/50 disabled:opacity-50 transition-colors"
            >
              {addingToPipeline ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <KanbanSquare className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
              CRM
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
