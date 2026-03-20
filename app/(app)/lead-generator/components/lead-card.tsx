"use client";

import { Lead } from "@/lib/types";
import {
  MapPin,
  Phone,
  Mail,
  Star,
  Globe,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  User,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Facebook,
  Instagram,
  Users,
  Copy,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { useState } from "react";

interface LeadCardProps {
  lead: Lead;
  selected: boolean;
  onSelect: (id: string) => void;
  onGenerateOutreach: (leadId: string) => void;
  generatingOutreach: boolean;
}

function WebsiteQualityBadge({ lead }: { lead: Lead }) {
  if (!lead.has_website) {
    return (
      <span className="shrink-0 border border-border px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-foreground">
        No site
      </span>
    );
  }

  const qualityConfig: Record<string, { label: string }> = {
    dead: { label: "Dead" },
    outdated: { label: "Dated" },
    poor: { label: "Weak" },
    decent: { label: "OK" },
    good: { label: "Solid" },
  };

  const config = qualityConfig[lead.website_quality || ""] || {
    label: "Web",
  };

  return (
    <span className="shrink-0 border border-border px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
      {config.label}
    </span>
  );
}

export function LeadCard({
  lead,
  selected,
  onSelect,
  onGenerateOutreach,
  generatingOutreach,
}: LeadCardProps) {
  const [expanded, setExpanded] = useState(false);

  const isHotLead =
    !lead.has_website ||
    lead.website_quality === "dead" ||
    lead.website_quality === "outdated" ||
    lead.website_quality === "poor";

  return (
    <div
      className={`rounded-2xl border bg-card p-5 transition-all duration-200 ${
        isHotLead
          ? "border-primary/20 shadow-sm shadow-primary/5"
          : "border-border opacity-70"
      } ${selected ? "ring-2 ring-primary" : ""}`}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          onClick={() => onSelect(lead.id)}
          className={`mt-1 shrink-0 w-5 h-5 rounded-md border-2 transition-all flex items-center justify-center ${
            selected
              ? "bg-primary border-primary"
              : "border-border hover:border-primary/50"
          }`}
        >
          {selected && <CheckCircle2 className="w-3 h-3 text-primary-foreground" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-sm font-medium text-foreground md:text-base">
              {lead.business_name}
            </h3>
            <WebsiteQualityBadge lead={lead} />
            {lead.website_score !== null && lead.website_score > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {lead.website_score}/100
              </span>
            )}
          </div>

          {lead.description && (
            <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
              {lead.description}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            {lead.address && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {lead.address}
              </span>
            )}
            {lead.phone && (
              <a href={`tel:${lead.phone}`} className="flex items-center gap-1 text-primary hover:underline">
                <Phone className="w-3 h-3" />
                {lead.phone}
              </a>
            )}
            {lead.email && (
              <a
                href={`mailto:${lead.email}`}
                className="flex items-center gap-1 underline-offset-4 hover:underline"
              >
                <Mail className="w-3 h-3" />
                {lead.email}
              </a>
            )}
            {lead.rating && (
              <span className="flex items-center gap-1">
                <Star className="h-3 w-3 text-muted-foreground" strokeWidth={1.25} />
                {lead.rating}
                {lead.review_count && <span>({lead.review_count})</span>}
              </span>
            )}
            {lead.owner_name && (
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" />
                {lead.owner_name}
              </span>
            )}
            {lead.follower_count && (
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" />
                {lead.follower_count.toLocaleString()} followers
              </span>
            )}
          </div>

          {/* Social links */}
          <div className="flex items-center gap-2 mt-2">
            {lead.google_maps_url && (
              <a href={lead.google_maps_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg bg-secondary hover:bg-secondary/80 transition-all text-muted-foreground">
                <MapPin className="w-3 h-3" /> Maps
              </a>
            )}
            {lead.website_url && (
              <a href={lead.website_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg bg-secondary hover:bg-secondary/80 transition-all text-muted-foreground">
                <Globe className="w-3 h-3" /> Website
              </a>
            )}
            {lead.facebook_url && (
              <a href={lead.facebook_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 transition-all text-blue-400">
                <Facebook className="w-3 h-3" /> Facebook
              </a>
            )}
            {lead.instagram_url && (
              <a href={lead.instagram_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg bg-pink-500/10 hover:bg-pink-500/20 transition-all text-pink-400">
                <Instagram className="w-3 h-3" /> Instagram
              </a>
            )}
          </div>
        </div>

        <div className="ml-2 flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onGenerateOutreach(lead.id)}
            disabled={generatingOutreach}
            className="border border-border p-2 text-foreground transition-colors hover:bg-secondary/50 disabled:opacity-50"
            title="Outreach"
          >
            {generatingOutreach ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MessageSquare className="h-4 w-4" strokeWidth={1.25} />
            )}
          </button>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="border border-border p-2 text-muted-foreground transition-colors hover:bg-secondary/50"
          >
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-border space-y-3 ml-8">
          {lead.review_highlights && lead.review_highlights.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-foreground mb-1.5">Reviews</p>
              <div className="space-y-1">
                {lead.review_highlights.map((r, i) => (
                  <p
                    key={i}
                    className="border-l border-foreground/20 pl-3 text-xs text-muted-foreground"
                  >
                    &ldquo;{r}&rdquo;
                  </p>
                ))}
              </div>
            </div>
          )}
          {lead.source && (
            <p className="text-[10px] text-muted-foreground">Sources: {lead.source}</p>
          )}
          {lead.enrichment_status === "completed" ? (
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <CheckCircle2 className="h-3 w-3" strokeWidth={1.25} /> Enriched
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
