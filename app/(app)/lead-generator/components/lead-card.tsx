"use client";

import { Lead } from "@/lib/types";
import { getWebsiteContext } from "@/lib/lead-utils";
import {
  MapPin,
  Phone,
  Mail,
  Star,
  Globe,
  User,
  CheckCircle2,
  Facebook,
  Instagram,
  Users,
  MessageSquare,
  Loader2,
  Linkedin,
  KanbanSquare,
  TrendingUp,
} from "lucide-react";

interface LeadCardProps {
  lead: Lead;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpenDrawer: (lead: Lead) => void;
  onGenerateOutreach: (leadId: string) => void;
  generatingOutreach: boolean;
  onAddToPipeline?: (leadId: string) => void;
  addingToPipeline?: boolean;
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const colorClass =
    score >= 70
      ? "text-green-500 border-green-500/25 bg-green-500/8"
      : score >= 40
        ? "text-amber-500 border-amber-500/25 bg-amber-500/8"
        : "text-muted-foreground border-border bg-transparent";

  return (
    <span
      className={`inline-flex items-center gap-0.5 border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${colorClass}`}
      title="Lead score — opportunité digitale"
    >
      <TrendingUp className="h-2.5 w-2.5" strokeWidth={2} />
      {score}
    </span>
  );
}

function WebsiteQualityBadge({ lead }: { lead: Lead }) {
  const ctx = getWebsiteContext(lead);

  if (!ctx) {
    return (
      <span className="shrink-0 border border-border px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-foreground">
        No site
      </span>
    );
  }

  if (!ctx.isOwned) {
    // Platform page — show label like "Planity", "Facebook", etc.
    return (
      <span className="shrink-0 border border-border px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-amber-600">
        {ctx.label}
      </span>
    );
  }

  const qualityConfig: Record<string, string> = {
    dead: "Dead",
    outdated: "Dated",
    poor: "Weak",
    decent: "OK",
    good: "Solid",
  };

  const label = qualityConfig[lead.website_quality || ""] || "Web";

  return (
    <span className="shrink-0 border border-border px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
      {label}
    </span>
  );
}

export function LeadCard({
  lead,
  selected,
  onSelect,
  onOpenDrawer,
  onGenerateOutreach,
  generatingOutreach,
  onAddToPipeline,
  addingToPipeline,
}: LeadCardProps) {
  const websiteCtx = getWebsiteContext(lead);
  const isHotLead =
    !websiteCtx?.isOwned ||
    lead.website_quality === "dead" ||
    lead.website_quality === "outdated" ||
    lead.website_quality === "poor";

  return (
    <div
      className={`rounded-2xl border bg-card transition-all duration-200 cursor-pointer ${
        isHotLead
          ? "border-primary/20 shadow-sm shadow-primary/5"
          : "border-border opacity-80"
      } ${selected ? "ring-2 ring-primary" : ""}`}
      onClick={() => onOpenDrawer(lead)}
    >
      <div className="p-5">
        <div className="flex items-start gap-3">
          {/* Checkbox — stops propagation so clicking it doesn't open the drawer */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(lead.id);
            }}
            className={`mt-1 shrink-0 w-5 h-5 rounded-md border-2 transition-all flex items-center justify-center ${
              selected
                ? "bg-primary border-primary"
                : "border-border hover:border-primary/50"
            }`}
          >
            {selected && <CheckCircle2 className="w-3 h-3 text-primary-foreground" />}
          </button>

          <div className="flex-1 min-w-0">
            {/* Title row */}
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-sm font-medium text-foreground md:text-base">
                {lead.business_name}
              </h3>

              {lead.enrichment_status === "pending" ? (
                <span className="shrink-0 border border-border px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Awaiting
                </span>
              ) : lead.enrichment_status === "enriching" ? (
                <span className="flex shrink-0 items-center gap-1 border border-border px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" /> Enriching
                </span>
              ) : (
                <>
                  <WebsiteQualityBadge lead={lead} />
                  {lead.website_score !== null && lead.website_score > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      {lead.website_score}/100
                    </span>
                  )}
                  <ScoreBadge score={lead.potential_score ?? null} />
                </>
              )}
            </div>

            {lead.description && (
              <p className="text-xs text-muted-foreground mb-2 line-clamp-1">
                {lead.description}
              </p>
            )}

            {/* Key info row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {lead.address && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3 shrink-0" />
                  <span className="truncate max-w-[160px]">{lead.address}</span>
                </span>
              )}
              {lead.phone && (
                <a
                  href={`tel:${lead.phone}`}
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 text-primary hover:underline"
                >
                  <Phone className="w-3 h-3" />
                  {lead.phone}
                </a>
              )}
              {lead.email && (
                <a
                  href={`mailto:${lead.email}`}
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 underline-offset-4 hover:underline"
                >
                  <Mail className="w-3 h-3" />
                  {lead.email}
                </a>
              )}
              {lead.rating && (
                <span className="flex items-center gap-1">
                  <Star className="h-3 w-3" strokeWidth={1.25} />
                  {lead.rating}
                  {lead.review_count && (
                    <span>({lead.review_count})</span>
                  )}
                </span>
              )}
              {lead.owner_name && (
                <span className="flex items-center gap-1 font-medium text-foreground">
                  <User className="w-3 h-3" />
                  {lead.owner_name}
                  {lead.owner_role && (
                    <span className="font-normal text-muted-foreground">
                      ({lead.owner_role})
                    </span>
                  )}
                </span>
              )}
              {lead.follower_count ? (
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {lead.follower_count.toLocaleString()}
                </span>
              ) : null}
            </div>

            {/* Social link pills */}
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {lead.google_maps_url && (
                <a
                  href={lead.google_maps_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg bg-secondary hover:bg-secondary/80 transition-all text-muted-foreground"
                >
                  <MapPin className="w-3 h-3" /> Maps
                </a>
              )}
              {websiteCtx && (
                <a
                  href={websiteCtx.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg transition-all ${
                    websiteCtx.isOwned
                      ? "bg-secondary hover:bg-secondary/80 text-muted-foreground"
                      : "bg-amber-50 hover:bg-amber-100 text-amber-700"
                  }`}
                >
                  <Globe className="w-3 h-3" />
                  {websiteCtx.isOwned ? "Site" : websiteCtx.label}
                </a>
              )}
              {lead.facebook_url && (
                <a
                  href={lead.facebook_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 transition-all text-blue-400"
                >
                  <Facebook className="w-3 h-3" /> FB
                </a>
              )}
              {lead.instagram_url && (
                <a
                  href={lead.instagram_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg bg-pink-500/10 hover:bg-pink-500/20 transition-all text-pink-400"
                >
                  <Instagram className="w-3 h-3" /> IG
                </a>
              )}
              {lead.linkedin_url && (
                <a
                  href={lead.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg bg-blue-600/10 hover:bg-blue-600/20 transition-all text-blue-500"
                >
                  <Linkedin className="w-3 h-3" /> LI
                </a>
              )}
            </div>
          </div>

          {/* Action buttons — stop propagation so they don't open the drawer */}
          <div className="ml-2 flex shrink-0 flex-col items-end gap-1">
            {onAddToPipeline && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToPipeline(lead.id);
                }}
                disabled={addingToPipeline}
                className="border border-border p-2 text-foreground transition-colors hover:bg-secondary/50 disabled:opacity-50"
                title="Ajouter au pipeline CRM"
              >
                {addingToPipeline ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <KanbanSquare className="h-4 w-4" strokeWidth={1.25} />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onGenerateOutreach(lead.id);
              }}
              disabled={generatingOutreach}
              className="border border-border p-2 text-foreground transition-colors hover:bg-secondary/50 disabled:opacity-50"
              title="Générer outreach"
            >
              {generatingOutreach ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessageSquare className="h-4 w-4" strokeWidth={1.25} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
