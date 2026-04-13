"use client";

import type { BusinessAnalysis, CompetitorAnalysis } from "@/lib/types";
import { Panel } from "@/components/ui/panel";
import { ScoreGauge } from "./score-gauge";
import { CompetitorTable } from "./competitor-table";
import {
  MapPin,
  Phone,
  Mail,
  Star,
  Globe,
  User,
  Building2,
  Hash,
  Calendar,
  DollarSign,
  Users,
  Linkedin,
  Facebook,
  Instagram,
  Shield,
  CalendarCheck,
  MessageCircle,
  Megaphone,
  AlertTriangle,
  ShoppingBag,
  ExternalLink,
} from "lucide-react";

interface AnalysisReportProps {
  analysis: BusinessAnalysis;
}

const severityColors: Record<string, string> = {
  critical: "border-red-500/30 bg-red-500/5 text-red-400",
  high: "border-amber-500/30 bg-amber-500/5 text-amber-400",
  medium: "border-zinc-400/30 bg-zinc-400/5 text-zinc-600 dark:text-zinc-400",
  low: "border-foreground/10 bg-secondary/50 text-muted-foreground",
};

const severityLabels: Record<string, string> = {
  critical: "Critique",
  high: "Important",
  medium: "Moyen",
  low: "Mineur",
};

const priorityColors: Record<string, string> = {
  high: "border-foreground bg-foreground text-primary-foreground",
  medium: "border-border bg-secondary text-foreground",
  low: "border-border text-muted-foreground",
};

export function AnalysisReport({ analysis }: AnalysisReportProps) {
  const a = analysis;
  // JSONB columns may deserialize as null from Supabase
  const painPoints = a.pain_points ?? [];
  const recommendedOffers = a.recommended_offers ?? [];
  const competitors = a.competitors ?? [];
  const reviewHighlights = a.review_highlights ?? [];

  return (
    <div className="space-y-8 animate-fade-in">
      {/* ── Header with score ── */}
      <Panel padding="lg" className="rounded-sm">
        <div className="flex flex-col items-center gap-8 md:flex-row md:items-start">
          <ScoreGauge score={a.potential_score} />

          <div className="flex-1 min-w-0">
            <h2 className="font-display text-2xl font-medium text-foreground md:text-3xl">
              {a.business_name}
            </h2>
            {a.address && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                {a.address}
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-3">
              {a.google_rating && (
                <span className="flex items-center gap-1 border border-border px-2.5 py-1 text-xs font-medium">
                  <Star className="h-3 w-3" strokeWidth={1.5} />
                  {a.google_rating}/5
                  {a.google_review_count && (
                    <span className="text-muted-foreground">({a.google_review_count} avis)</span>
                  )}
                </span>
              )}
              {a.website_url ? (
                <a href={a.website_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 border border-border px-2.5 py-1 text-xs font-medium hover:bg-secondary/50 transition-colors">
                  <Globe className="h-3 w-3" strokeWidth={1.5} />
                  {a.website_score != null ? `${a.website_score}/100` : "Site"} 
                  <ExternalLink className="h-2.5 w-2.5 text-muted-foreground" />
                </a>
              ) : (
                <span className="flex items-center gap-1 border border-red-500/20 bg-red-500/5 px-2.5 py-1 text-xs font-medium text-red-400">
                  <Globe className="h-3 w-3" strokeWidth={1.5} />
                  Pas de site web
                </span>
              )}
              {a.has_meta_ads ? (
                <span className="flex items-center gap-1 border border-green-500/20 bg-green-500/5 px-2.5 py-1 text-xs font-medium text-green-500">
                  <Megaphone className="h-3 w-3" strokeWidth={1.5} />
                  {a.meta_ads_count} ads Meta
                </span>
              ) : (
                <span className="flex items-center gap-1 border border-red-500/20 bg-red-500/5 px-2.5 py-1 text-xs font-medium text-red-400">
                  <Megaphone className="h-3 w-3" strokeWidth={1.5} />
                  Pas de pub
                </span>
              )}
            </div>

            {/* Quick digital status pills */}
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusPill label="HTTPS" ok={a.has_https} icon={Shield} />
              <StatusPill label="Réservation" ok={a.has_booking} icon={CalendarCheck} />
              <StatusPill label="Chatbot" ok={a.has_chatbot} icon={MessageCircle} />
            </div>
          </div>
        </div>
      </Panel>

      {/* ── Pain Points ── */}
      {painPoints.length > 0 && (
        <div>
          <h3 className="label-eyebrow mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" strokeWidth={1.5} />
            Lacunes détectées ({painPoints.length})
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {painPoints.map((pp) => (
              <div
                key={pp.id}
                className={`border p-4 transition-colors ${severityColors[pp.severity]}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <h4 className="text-sm font-medium">{pp.label}</h4>
                  <span className="shrink-0 text-[9px] font-medium uppercase tracking-[0.1em]">
                    {severityLabels[pp.severity]}
                  </span>
                </div>
                <p className="text-xs leading-relaxed opacity-80">{pp.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Recommended Offers ── */}
      {recommendedOffers.length > 0 && (
        <div>
          <h3 className="label-eyebrow mb-4 flex items-center gap-2">
            <ShoppingBag className="h-4 w-4" strokeWidth={1.5} />
            Offres recommandées ({recommendedOffers.length})
          </h3>
          <div className="space-y-2">
            {recommendedOffers.map((offer) => (
              <Panel key={offer.id} padding="sm" className="rounded-sm flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h4 className="text-sm font-medium text-foreground">{offer.name}</h4>
                    <span className={`shrink-0 border px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] ${priorityColors[offer.priority]}`}>
                      {offer.priority === "high" ? "Prioritaire" : offer.priority === "medium" ? "Recommandé" : "Optionnel"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-1">{offer.reason}</p>
                </div>
                <span className="shrink-0 text-sm font-medium text-foreground">{offer.estimated_value}</span>
              </Panel>
            ))}
          </div>
        </div>
      )}

      {/* ── Competitor Spy ── */}
      {competitors.length > 0 && (
        <div>
          <h3 className="label-eyebrow mb-4">Concurrents locaux ({competitors.length})</h3>
          <Panel padding="none" className="rounded-sm overflow-hidden">
            <CompetitorTable
              prospect={{
                business_name: a.business_name,
                website_url: a.website_url,
                website_score: a.website_score,
                google_rating: a.google_rating,
                google_review_count: a.google_review_count,
                has_meta_ads: a.has_meta_ads,
                facebook_url: a.facebook_url,
                instagram_url: a.instagram_url,
              }}
              competitors={competitors}
            />
          </Panel>
          <CompetitorInsight
            businessName={a.business_name}
            hasMetaAds={a.has_meta_ads}
            competitors={competitors}
          />
        </div>
      )}

      {/* ── Contact & Legal Info ── */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Contact */}
        <Panel padding="md" className="rounded-sm">
          <h3 className="label-eyebrow mb-4 flex items-center gap-2">
            <User className="h-4 w-4" strokeWidth={1.5} />
            Contact
          </h3>
          <div className="space-y-2 text-sm">
            {a.phone && (
              <InfoRow icon={Phone} label="Téléphone">
                <a href={`tel:${a.phone}`} className="text-foreground hover:underline">{a.phone}</a>
              </InfoRow>
            )}
            {a.email && (
              <InfoRow icon={Mail} label="Email">
                <a href={`mailto:${a.email}`} className="hover:underline">{a.email}</a>
              </InfoRow>
            )}
            {a.owner_name && (
              <InfoRow icon={User} label="Gérant">
                <span className="font-medium text-foreground">{a.owner_name}</span>
                {a.owner_role && <span className="text-muted-foreground"> ({a.owner_role})</span>}
              </InfoRow>
            )}
            {a.owner_phone && (
              <InfoRow icon={Phone} label="Tél. perso">
                <a href={`tel:${a.owner_phone}`} className="text-foreground hover:underline">{a.owner_phone}</a>
              </InfoRow>
            )}
            {a.owner_email && (
              <InfoRow icon={Mail} label="Email perso">
                <a href={`mailto:${a.owner_email}`} className="hover:underline">{a.owner_email}</a>
              </InfoRow>
            )}
          </div>

          {/* Social links */}
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
            {a.google_maps_url && (
              <SocialLink href={a.google_maps_url} icon={MapPin} label="Maps" color="text-green-500" bg="bg-green-500/10" />
            )}
            {a.website_url && (
              <SocialLink href={a.website_url} icon={Globe} label="Site" color="text-foreground" bg="bg-secondary" />
            )}
            {a.facebook_url && (
              <SocialLink href={a.facebook_url} icon={Facebook} label="Facebook" color="text-slate-600" bg="bg-slate-500/10" />
            )}
            {a.instagram_url && (
              <SocialLink href={a.instagram_url} icon={Instagram} label="Instagram" color="text-pink-400" bg="bg-pink-500/10" />
            )}
            {a.linkedin_url && (
              <SocialLink href={a.linkedin_url} icon={Linkedin} label="LinkedIn" color="text-[#0A66C2]" bg="bg-[#0A66C2]/10" />
            )}
          </div>
        </Panel>

        {/* Legal info */}
        <Panel padding="md" className="rounded-sm">
          <h3 className="label-eyebrow mb-4 flex items-center gap-2">
            <Building2 className="h-4 w-4" strokeWidth={1.5} />
            Informations légales
          </h3>
          <div className="space-y-2 text-sm">
            {a.siren && <InfoRow icon={Hash} label="SIREN">{a.siren}</InfoRow>}
            {a.siret && <InfoRow icon={Hash} label="SIRET">{a.siret}</InfoRow>}
            {a.company_type && <InfoRow icon={Building2} label="Forme">{a.company_type}</InfoRow>}
            {a.creation_date && <InfoRow icon={Calendar} label="Création">{a.creation_date}</InfoRow>}
            {a.revenue_bracket && <InfoRow icon={DollarSign} label="CA">{a.revenue_bracket}</InfoRow>}
            {a.employee_count && <InfoRow icon={Users} label="Employés">{a.employee_count}</InfoRow>}
            {!a.siren && !a.company_type && !a.creation_date && (
              <p className="text-xs text-muted-foreground">Aucune donnée légale trouvée</p>
            )}
          </div>
        </Panel>
      </div>

      {/* ── Reviews ── */}
      {reviewHighlights.length > 0 && (
        <div>
          <h3 className="label-eyebrow mb-3">Avis clients</h3>
          <div className="space-y-2">
            {reviewHighlights.map((review, i) => (
              <p key={i} className="border-l-2 border-foreground/10 pl-4 text-sm text-muted-foreground">
                &ldquo;{review}&rdquo;
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StatusPill({ label, ok, icon: Icon }: { label: string; ok: boolean; icon: React.ElementType }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] border ${
      ok
        ? "border-green-500/20 bg-green-500/5 text-green-500"
        : "border-red-500/20 bg-red-500/5 text-red-400"
    }`}>
      <Icon className="h-3 w-3" strokeWidth={1.5} />
      {label}: {ok ? "Oui" : "Non"}
    </span>
  );
}

function InfoRow({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-muted-foreground">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
      <span className="shrink-0 w-20 text-xs text-muted-foreground">{label}</span>
      <span className="text-xs">{children}</span>
    </div>
  );
}

function SocialLink({ href, icon: Icon, label, color, bg }: {
  href: string;
  icon: React.ElementType;
  label: string;
  color: string;
  bg: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg ${bg} ${color} hover:opacity-80 transition-opacity`}
    >
      <Icon className="h-3 w-3" /> {label}
    </a>
  );
}

function CompetitorInsight({
  businessName,
  hasMetaAds,
  competitors,
}: {
  businessName: string;
  hasMetaAds: boolean;
  competitors: CompetitorAnalysis[];
}) {
  const competitorsWithAds = competitors.filter((c) => c.has_meta_ads).length;
  const competitorsWithSites = competitors.filter((c) => !!c.website_url).length;

  if (competitorsWithAds === 0 && competitorsWithSites === 0) return null;

  const insights: string[] = [];

  if (!hasMetaAds && competitorsWithAds > 0) {
    insights.push(
      `${competitorsWithAds} concurrent${competitorsWithAds > 1 ? "s" : ""} ${competitorsWithAds > 1 ? "font" : "fait"} de la publicité Meta. ${businessName} est en retard.`
    );
  }

  if (competitorsWithSites >= 3) {
    insights.push(
      `${competitorsWithSites}/${competitors.length} concurrents ont un site web. La présence en ligne est standard dans ce secteur.`
    );
  }

  const bestRating = Math.max(...competitors.map((c) => c.rating ?? 0));
  const bestComp = competitors.find((c) => c.rating === bestRating);
  if (bestComp && bestComp.rating && bestComp.rating > 4.5) {
    insights.push(
      `${bestComp.business_name} domine avec ${bestComp.rating}/5 et ${bestComp.review_count || "?"} avis.`
    );
  }

  if (insights.length === 0) return null;

  return (
    <div className="mt-3 border border-amber-500/20 bg-amber-500/5 p-4">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-amber-500 mb-2">
        Argument de vente
      </p>
      {insights.map((insight, i) => (
        <p key={i} className="text-xs leading-relaxed text-foreground/80">
          {insight}
        </p>
      ))}
    </div>
  );
}
