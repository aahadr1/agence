"use client";

import type { CompetitorAnalysis } from "@/lib/types";
import {
  Globe,
  Star,
  Facebook,
  Instagram,
  Megaphone,
  CheckCircle2,
  XCircle,
  MapPin,
} from "lucide-react";

interface CompetitorTableProps {
  prospect: {
    business_name: string;
    website_url: string | null;
    website_score: number | null;
    google_rating: number | null;
    google_review_count: number | null;
    has_meta_ads: boolean;
    facebook_url: string | null;
    instagram_url: string | null;
  };
  competitors: CompetitorAnalysis[];
}

function YesNo({ value, invert }: { value: boolean; invert?: boolean }) {
  const isGood = invert ? !value : value;
  return isGood ? (
    <CheckCircle2 className="mx-auto h-4 w-4 text-green-500" strokeWidth={1.5} />
  ) : (
    <XCircle className="mx-auto h-4 w-4 text-red-400" strokeWidth={1.5} />
  );
}

function RatingBadge({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-xs text-muted-foreground">—</span>;
  const color =
    rating >= 4.5 ? "text-green-500" : rating >= 4 ? "text-foreground" : rating >= 3.5 ? "text-amber-500" : "text-red-400";
  return (
    <span className={`flex items-center justify-center gap-1 text-xs font-medium ${color}`}>
      <Star className="h-3 w-3" strokeWidth={1.5} />
      {rating.toFixed(1)}
    </span>
  );
}

export function CompetitorTable({ prospect, competitors }: CompetitorTableProps) {
  if (competitors.length === 0) return null;

  const columns = [
    { key: "name", label: "Business" },
    { key: "website", label: "Site Web" },
    { key: "score", label: "Score" },
    { key: "rating", label: "Avis" },
    { key: "reviews", label: "Nb avis" },
    { key: "ads", label: "Ads Meta" },
    { key: "social", label: "Réseaux" },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Prospect row — highlighted */}
          <tr className="border-b border-border bg-blue-subtle">
            <td className="px-3 py-3">
              <span className="font-medium text-foreground">{prospect.business_name}</span>
              <span className="ml-2 text-[9px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                prospect
              </span>
            </td>
            <td className="px-3 py-3 text-center">
              <YesNo value={!!prospect.website_url} />
            </td>
            <td className="px-3 py-3 text-center text-xs font-mono">
              {prospect.website_score != null ? `${prospect.website_score}/100` : "—"}
            </td>
            <td className="px-3 py-3 text-center">
              <RatingBadge rating={prospect.google_rating} />
            </td>
            <td className="px-3 py-3 text-center text-xs">
              {prospect.google_review_count ?? "—"}
            </td>
            <td className="px-3 py-3 text-center">
              <YesNo value={prospect.has_meta_ads} />
            </td>
            <td className="px-3 py-3">
              <div className="flex items-center justify-center gap-1.5">
                {prospect.facebook_url ? <Facebook className="h-3.5 w-3.5 text-slate-600" /> : <Facebook className="h-3.5 w-3.5 text-red-400/40" />}
                {prospect.instagram_url ? <Instagram className="h-3.5 w-3.5 text-pink-400" /> : <Instagram className="h-3.5 w-3.5 text-red-400/40" />}
              </div>
            </td>
          </tr>

          {/* Competitor rows */}
          {competitors.map((comp, i) => (
            <tr key={i} className="border-b border-border hover:bg-secondary/30 transition-colors">
              <td className="px-3 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-foreground">{comp.business_name}</span>
                  {comp.google_maps_url && (
                    <a href={comp.google_maps_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                      <MapPin className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </td>
              <td className="px-3 py-3 text-center">
                <YesNo value={!!comp.website_url} />
              </td>
              <td className="px-3 py-3 text-center text-xs font-mono">
                {comp.website_score != null ? `${comp.website_score}/100` : "—"}
              </td>
              <td className="px-3 py-3 text-center">
                <RatingBadge rating={comp.rating} />
              </td>
              <td className="px-3 py-3 text-center text-xs">
                {comp.review_count ?? "—"}
              </td>
              <td className="px-3 py-3 text-center">
                <YesNo value={comp.has_meta_ads} />
              </td>
              <td className="px-3 py-3">
                <div className="flex items-center justify-center gap-1.5">
                  {comp.facebook_url ? <Facebook className="h-3.5 w-3.5 text-slate-600" /> : <Facebook className="h-3.5 w-3.5 text-muted-foreground/30" />}
                  {comp.instagram_url ? <Instagram className="h-3.5 w-3.5 text-pink-400" /> : <Instagram className="h-3.5 w-3.5 text-muted-foreground/30" />}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
