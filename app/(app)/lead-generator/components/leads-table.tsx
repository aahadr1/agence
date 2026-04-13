"use client";

import { useState, useCallback } from "react";
import {
  Globe,
  GlobeOff,
  Phone,
  Mail,
  Linkedin,
  Building2,
  User,
  ExternalLink,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  MoreHorizontal,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  Flame,
  Thermometer,
  Snowflake,
  TrendingUp,
  Tag,
  FileText,
  Loader2,
} from "lucide-react";
import type { Lead } from "@/lib/types";
import { getWebsiteContext } from "@/lib/lead-utils";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SortField =
  | "business_name"
  | "potential_score"
  | "priority_score"
  | "pipeline_status"
  | "employee_count"
  | "created_at"
  | "next_action_date";

type SortDir = "asc" | "desc";

export interface LeadsTableProps {
  leads: Lead[];
  loading?: boolean;
  onLeadClick?: (lead: Lead) => void;
  onLeadUpdate?: (leadId: string, updates: Partial<Lead>) => void;
  selectedIds?: Set<string>;
  onSelectChange?: (ids: Set<string>) => void;
}

// ---------------------------------------------------------------------------
// Helpers / sub-components
// ---------------------------------------------------------------------------

const PIPELINE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  new: { label: "Nouveau", color: "bg-slate-100 text-slate-700" },
  to_contact: { label: "À contacter", color: "bg-blue-50 text-blue-700" },
  contacted: { label: "Contacté", color: "bg-indigo-50 text-indigo-700" },
  responded: { label: "Répondu", color: "bg-violet-50 text-violet-700" },
  demo_sent: { label: "Démo envoyée", color: "bg-amber-50 text-amber-700" },
  proposal_sent: { label: "Devis envoyé", color: "bg-orange-50 text-orange-700" },
  negotiation: { label: "Négociation", color: "bg-yellow-50 text-yellow-700" },
  won: { label: "Gagné", color: "bg-emerald-50 text-emerald-700" },
  lost: { label: "Perdu", color: "bg-red-50 text-red-700" },
  not_interested: { label: "Pas intéressé", color: "bg-gray-100 text-gray-500" },
};

const OFFER_LABELS: Record<string, string> = {
  website: "Site web",
  software: "Logiciel",
  ads: "Publicité",
  combo: "Site + Ads",
  seo: "SEO",
  other: "Autre",
};

function PriorityBadge({ score }: { score: string | null }) {
  if (!score) return <span className="text-muted-foreground text-xs">—</span>;
  if (score === "hot")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
        <Flame className="h-3 w-3" />
        Chaud
      </span>
    );
  if (score === "warm")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
        <Thermometer className="h-3 w-3" />
        Tiède
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
      <Snowflake className="h-3 w-3" />
      Froid
    </span>
  );
}

function PipelineStatusBadge({ status }: { status: string | null }) {
  const s = status || "new";
  const { label, color } = PIPELINE_STATUS_LABELS[s] || {
    label: s,
    color: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", color)}>
      {label}
    </span>
  );
}

/** Platform badge colour map */
const PLATFORM_COLORS: Record<string, string> = {
  facebook_page: "text-blue-600 bg-blue-50",
  instagram_page: "text-pink-600 bg-pink-50",
  planity: "text-purple-600 bg-purple-50",
  treatwell: "text-teal-600 bg-teal-50",
  doctolib: "text-sky-600 bg-sky-50",
  booking: "text-indigo-600 bg-indigo-50",
  thefork: "text-orange-600 bg-orange-50",
  tripadvisor: "text-green-700 bg-green-50",
  pagesjaunes: "text-yellow-700 bg-yellow-50",
  google_maps: "text-slate-600 bg-slate-100",
  directory: "text-slate-500 bg-slate-100",
};

function WebsiteCell({ lead }: { lead: Lead }) {
  const ctx = getWebsiteContext(lead);

  if (!ctx) {
    // Don't declare "no website" until enrichment has actually checked
    if (lead.enrichment_status === "pending" || lead.enrichment_status === "enriching") {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Recherche...
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-500 font-medium">
        <GlobeOff className="h-3.5 w-3.5" />
        Aucun site
      </span>
    );
  }

  if (ctx.isOwned) {
    return (
      <a
        href={ctx.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
      >
        <Globe className="h-3.5 w-3.5" />
        <span className="max-w-[120px] truncate">
          {ctx.url.replace(/^https?:\/\/(www\.)?/, "")}
        </span>
        <ExternalLink className="h-3 w-3 opacity-50" />
      </a>
    );
  }

  // Platform page (Planity, Facebook, etc.)
  const colorClass = PLATFORM_COLORS[ctx.type ?? ""] || "text-slate-500 bg-slate-100";
  return (
    <a
      href={ctx.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium hover:opacity-80",
        colorClass
      )}
      title={ctx.url}
    >
      {ctx.label}
      <ExternalLink className="h-2.5 w-2.5 opacity-60" />
    </a>
  );
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-muted-foreground">—</span>;
  const color =
    score >= 70
      ? "text-red-600 bg-red-50"
      : score >= 40
      ? "text-amber-600 bg-amber-50"
      : "text-slate-500 bg-slate-100";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums", color)}>
      <TrendingUp className="h-3 w-3" />
      {score}
    </span>
  );
}

function EnrichmentStepBadge({ step, status }: { step: string | null; status: string }) {
  if (status === "completed" || step === "done") return null;
  if (status === "failed" || step === "failed")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-500">
        <XCircle className="h-3 w-3" />
        Échec
      </span>
    );
  if (status === "enriching" || status === "pending")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-blue-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        {step ? step.replace(/_/g, " ") : "En cours..."}
      </span>
    );
  return null;
}

function SortIcon({
  field,
  sortField,
  sortDir,
}: {
  field: SortField;
  sortField: SortField;
  sortDir: SortDir;
}) {
  if (sortField !== field) return <ChevronsUpDown className="h-3 w-3 opacity-30" />;
  return sortDir === "asc" ? (
    <ChevronUp className="h-3 w-3" />
  ) : (
    <ChevronDown className="h-3 w-3" />
  );
}

// Inline editable pipeline status dropdown
function StatusDropdown({
  lead,
  onUpdate,
}: {
  lead: Lead;
  onUpdate?: (id: string, updates: Partial<Lead>) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = lead.pipeline_status;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="focus:outline-none"
      >
        <PipelineStatusBadge status={current} />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          />
          <div className="absolute left-0 top-6 z-20 w-44 rounded-lg border border-border bg-background shadow-lg">
            {Object.entries(PIPELINE_STATUS_LABELS).map(([value, { label, color }]) => (
              <button
                key={value}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate?.(lead.id, { pipeline_status: value } as Partial<Lead>);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent",
                  current === value && "bg-accent"
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", color.includes("emerald") ? "bg-emerald-500" : color.includes("red") ? "bg-red-500" : color.includes("amber") ? "bg-amber-500" : "bg-slate-400")} />
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LeadsTable({
  leads,
  loading = false,
  onLeadClick,
  onLeadUpdate,
  selectedIds = new Set(),
  onSelectChange,
}: LeadsTableProps) {
  const [sortField, setSortField] = useState<SortField>("potential_score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDir("desc");
      }
    },
    [sortField]
  );

  const sorted = [...leads].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortField === "potential_score") {
      return ((a.potential_score ?? -1) - (b.potential_score ?? -1)) * dir;
    }
    if (sortField === "business_name") {
      return a.business_name.localeCompare(b.business_name) * dir;
    }
    if (sortField === "priority_score") {
      const order = { hot: 3, warm: 2, cold: 1 };
      const av = a.priority_score;
      const bv = b.priority_score;
      return ((order[av as keyof typeof order] ?? 0) - (order[bv as keyof typeof order] ?? 0)) * dir;
    }
    if (sortField === "created_at") {
      return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
    }
    return 0;
  });

  const allSelected = sorted.length > 0 && sorted.every((l) => selectedIds.has(l.id));

  function toggleAll() {
    if (allSelected) {
      onSelectChange?.(new Set());
    } else {
      onSelectChange?.(new Set(sorted.map((l) => l.id)));
    }
  }

  function toggleOne(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectChange?.(next);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Chargement des leads...
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Building2 className="mb-3 h-10 w-10 text-muted-foreground/30" />
        <p className="text-sm font-medium text-foreground">Aucun lead trouvé</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Lancez une recherche pour découvrir de nouveaux prospects.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[1400px] text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {/* Checkbox */}
            <th className="w-8 px-3 py-2.5">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="h-3.5 w-3.5 rounded border-border"
              />
            </th>

            {/* IDENTIFICATION */}
            <th
              className="cursor-pointer whitespace-nowrap px-3 py-2.5 text-left font-semibold text-muted-foreground"
              onClick={() => handleSort("business_name")}
            >
              <span className="inline-flex items-center gap-1">
                Entreprise <SortIcon field="business_name" sortField={sortField} sortDir={sortDir} />
              </span>
            </th>
            <th className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-muted-foreground">
              Secteur
            </th>
            <th className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-muted-foreground">
              Ville
            </th>
            <th className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-muted-foreground">
              Taille
            </th>
            <th className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-muted-foreground">
              Source
            </th>

            {/* CONTACT */}
            <th className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-muted-foreground">
              Décideur
            </th>
            <th className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-muted-foreground">
              Téléphone
            </th>
            <th className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-muted-foreground">
              Email
            </th>
            <th className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-muted-foreground">
              Site
            </th>

            {/* QUALIFICATION */}
            <th
              className="cursor-pointer whitespace-nowrap px-3 py-2.5 text-left font-semibold text-muted-foreground"
              onClick={() => handleSort("priority_score")}
            >
              <span className="inline-flex items-center gap-1">
                Priorité <SortIcon field="priority_score" sortField={sortField} sortDir={sortDir} />
              </span>
            </th>
            <th
              className="cursor-pointer whitespace-nowrap px-3 py-2.5 text-left font-semibold text-muted-foreground"
              onClick={() => handleSort("potential_score")}
            >
              <span className="inline-flex items-center gap-1">
                Score <SortIcon field="potential_score" sortField={sortField} sortDir={sortDir} />
              </span>
            </th>
            <th className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-muted-foreground">
              Offre cible
            </th>
            <th className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-muted-foreground">
              Besoin identifié
            </th>

            {/* PIPELINE */}
            <th
              className="cursor-pointer whitespace-nowrap px-3 py-2.5 text-left font-semibold text-muted-foreground"
              onClick={() => handleSort("pipeline_status")}
            >
              <span className="inline-flex items-center gap-1">
                Statut <SortIcon field="pipeline_status" sortField={sortField} sortDir={sortDir} />
              </span>
            </th>
            <th className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-muted-foreground">
              Prochaine action
            </th>

            {/* FOLLOW-UP */}
            <th className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-muted-foreground">
              Tentatives
            </th>
            <th className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-muted-foreground">
              Devis
            </th>
            <th className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-muted-foreground">
              Enrichissement
            </th>

            {/* Actions */}
            <th className="w-10 px-3 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sorted.map((lead) => {
            const isSelected = selectedIds.has(lead.id);
            const salesBriefPreview =
              typeof lead.enrichment_data?.sales_brief === "string"
                ? `${lead.enrichment_data.sales_brief.slice(0, 60)}…`
                : null;
            const ownerPhone = lead.owner_phone || lead.phone;
            const ownerEmail = lead.owner_email || lead.email;

            return (
              <tr
                key={lead.id}
                onClick={() => onLeadClick?.(lead)}
                className={cn(
                  "cursor-pointer transition-colors hover:bg-accent/40",
                  isSelected && "bg-primary/5"
                )}
              >
                {/* Checkbox */}
                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOne(lead.id)}
                    className="h-3.5 w-3.5 rounded border-border"
                  />
                </td>

                {/* IDENTIFICATION */}
                <td className="max-w-[160px] px-3 py-2.5">
                  <div className="flex flex-col gap-0.5">
                    <span className="truncate font-semibold text-foreground">
                      {lead.business_name}
                    </span>
                    {lead.google_maps_url && (
                      <a
                        href={lead.google_maps_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        Google Maps ↗
                      </a>
                    )}
                  </div>
                </td>

                <td className="px-3 py-2.5 text-muted-foreground">
                  <span className="max-w-[90px] truncate block">{lead.niche || "—"}</span>
                </td>

                <td className="px-3 py-2.5 text-muted-foreground">
                  <span className="max-w-[100px] truncate block">
                    {(lead.location || lead.address || "—")
                      .replace(/\d{5}\s*/g, "")
                      .split(",")[0]
                      .trim()}
                  </span>
                </td>

                <td className="px-3 py-2.5 text-muted-foreground">
                  {lead.employee_count || (lead.company_type ? lead.company_type : "—")}
                </td>

                <td className="px-3 py-2.5">
                  {lead.source ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {lead.source}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>

                {/* CONTACT */}
                <td className="px-3 py-2.5">
                  {lead.owner_name ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="inline-flex items-center gap-1 font-medium text-foreground">
                        <User className="h-3 w-3 text-muted-foreground" />
                        {lead.owner_name}
                      </span>
                      {lead.owner_role && (
                        <span className="text-[10px] text-muted-foreground">{lead.owner_role}</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>

                <td className="px-3 py-2.5">
                  {ownerPhone ? (
                    <a
                      href={`tel:${ownerPhone.replace(/\s/g, "")}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-foreground hover:text-primary"
                    >
                      <Phone className="h-3 w-3 text-muted-foreground" />
                      {ownerPhone}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>

                <td className="px-3 py-2.5">
                  {ownerEmail ? (
                    <a
                      href={`mailto:${ownerEmail}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-foreground hover:text-primary"
                    >
                      <Mail className="h-3 w-3 text-muted-foreground" />
                      <span className="max-w-[140px] truncate">{ownerEmail}</span>
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>

                <td className="px-3 py-2.5">
                  <div className="flex flex-col gap-1">
                    <WebsiteCell lead={lead} />
                    {lead.linkedin_url && (
                      <a
                        href={lead.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex w-fit items-center gap-1 rounded-full bg-[#0A66C2]/10 px-2 py-0.5 text-[10px] font-medium text-[#0A66C2] hover:bg-[#0A66C2]/20 transition-colors"
                      >
                        <Linkedin className="h-3 w-3" />
                        LinkedIn
                      </a>
                    )}
                  </div>
                </td>

                {/* QUALIFICATION */}
                <td className="px-3 py-2.5">
                  <PriorityBadge score={lead.priority_score} />
                </td>

                <td className="px-3 py-2.5">
                  <ScoreBadge score={lead.potential_score} />
                </td>

                <td className="px-3 py-2.5 text-muted-foreground">
                  {lead.targeted_offer ? (
                    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px]">
                      <Tag className="h-2.5 w-2.5" />
                      {OFFER_LABELS[lead.targeted_offer] || lead.targeted_offer}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>

                <td className="max-w-[160px] px-3 py-2.5 text-muted-foreground">
                  <span className="truncate block text-xs">
                    {lead.identified_need || salesBriefPreview || "—"}
                  </span>
                </td>

                {/* PIPELINE */}
                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <StatusDropdown lead={lead} onUpdate={onLeadUpdate} />
                </td>

                <td className="px-3 py-2.5">
                  {lead.next_action ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs text-foreground">{lead.next_action}</span>
                      {lead.next_action_date ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="h-2.5 w-2.5" />
                          {new Date(lead.next_action_date).toLocaleDateString("fr-FR")}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>

                {/* FOLLOW-UP */}
                <td className="px-3 py-2.5 text-center text-muted-foreground tabular-nums">
                  {lead.contact_attempts || 0}
                </td>

                <td className="px-3 py-2.5">
                  {lead.quote_sent ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                        <CheckCircle2 className="h-3 w-3" />
                        Envoyé
                      </span>
                      {lead.quote_amount ? (
                        <span className="text-[10px] font-semibold text-foreground">
                          {lead.quote_amount}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>

                <td className="px-3 py-2.5">
                  <EnrichmentStepBadge
                    step={lead.enrichment_step}
                    status={lead.enrichment_status}
                  />
                  {lead.enrichment_status === "completed" && (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                      <CheckCircle2 className="h-3 w-3" />
                      Enrichi
                    </span>
                  )}
                </td>

                {/* Actions */}
                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => onLeadClick?.(lead)}
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
