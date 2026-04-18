export type ProjectStatus = "info_gathering" | "ideation" | "selection" | "completed" | "building" | "deployed";

export interface BusinessInfo {
  name: string;
  address: string;
  hours: string;
  cuisine?: string;
  menu?: string;
  description: string;
  vibe?: string;
  uniqueSellingPoints?: string[];
  customerSentiment?: string;
  socialMedia: {
    instagram?: string;
    facebook?: string;
    twitter?: string;
    website?: string;
  };
  logoUrl?: string;
  colors: string[];
  photos: string[];
  phone?: string;
  priceRange?: string;
  rating?: string;
  reviewHighlights?: string[];
}

export interface ProjectImage {
  id: string;
  project_id: string;
  storage_path: string;
  url: string;
  type: "logo" | "photo";
  analysis: ImageAnalysis | null;
  created_at: string;
}

export interface ImageAnalysis {
  description: string;
  quality: "low" | "medium" | "high" | "excellent";
  suggestedPlacement: string;
  dominantColors: string[];
  mood: string;
  websiteRelevance: string;
}

export interface Project {
  id: string;
  user_id: string;
  business_info: BusinessInfo;
  status: ProjectStatus;
  selected_variant_id: string | null;
  user_colors: string[];
  user_instructions: string;
  created_at: string;
  updated_at: string;
}

export interface Variant {
  id: string;
  project_id: string;
  prompt: string;
  image_url: string | null;
  theme_name: string;
  color_scheme: { primary: string; secondary: string; accent: string } | null;
  selected: boolean;
  created_at: string;
}

// Lead Generator types
export type LeadSearchStatus = "searching" | "analyzing" | "enriching" | "completed" | "failed";
export type WebsiteQuality = "none" | "dead" | "outdated" | "poor" | "decent" | "good";
export type EnrichmentStatus = "pending" | "enriching" | "completed" | "failed";
export type LeadListItemStatus = "new" | "contacted" | "responded" | "not_interested";

export interface LeadSearch {
  id: string;
  user_id: string;
  niche: string;
  location: string;
  status: LeadSearchStatus;
  raw_research: string | null;
  leads_count: number;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  search_id: string;
  user_id: string;
  business_name: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  rating: string | null;
  review_count: string | null;
  review_highlights: string[] | null;
  niche: string | null;
  location: string | null;
  source: string | null;
  has_website: boolean;
  website_url: string | null;
  google_maps_url: string | null;
  website_quality: WebsiteQuality | null;
  website_score: number | null;
  owner_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  owner_role: string | null;
  linkedin_url: string | null;
  siren: string | null;
  company_type: string | null;
  creation_date: string | null;
  revenue_bracket: string | null;
  employee_count: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  follower_count: number | null;
  // V2 multi-offer fields
  has_https: boolean | null;
  has_booking: boolean | null;
  has_chatbot: boolean | null;
  has_meta_ads: boolean | null;
  meta_ads_count: number | null;
  potential_score: number | null;
  /** Agent / tool confidence 0–100 (migration 024) */
  confidence_score: number | null;
  pain_points: PainPoint[] | null;
  recommended_offers: RecommendedOffer[] | null;
  enrichment_data: Record<string, unknown>;
  enrichment_status: EnrichmentStatus;
  enrichment_step: string | null;
  // Pipeline / qualification fields (migration 018)
  prospect_analysis: string | null;
  targeted_offer: string | null;
  identified_need: string | null;
  priority_score: "hot" | "warm" | "cold" | null;
  pipeline_status: string | null;
  first_contact_date: string | null;
  last_contact_date: string | null;
  next_action: string | null;
  next_action_date: string | null;
  contact_channel: string | null;
  contact_attempts: number;
  notes: string | null;
  demo_site_created: boolean;
  demo_site_url: string | null;
  quote_sent: boolean;
  quote_amount: string | null;
  decision_maker_confirmed: boolean;
  estimated_budget: string | null;
  updated_at: string;
  created_at: string;
}

export interface LeadListSearchContext {
  niche: string | null;
  location: string | null;
  seed_query: string | null;
  keyword_history: string[];
  query_history: string[];
  attempted_queries: string[];
  attempted_keywords: string[];
  successful_queries: string[];
  last_generated_queries: string[];
  last_generated_keywords: string[];
  target_min_new_leads: number;
  expansion_count: number;
  last_run_added: number;
  last_expanded_at: string | null;
  updated_at: string | null;
}

export interface LeadList {
  id: string;
  user_id: string;
  name: string;
  keywords: string[];
  excluded_business_names: string[];
  search_context: LeadListSearchContext | null;
  created_at: string;
  updated_at: string;
  lead_list_items?: Array<{ count: number }>;
}

export interface LeadListItem {
  id: string;
  list_id: string;
  lead_id: string;
  status: LeadListItemStatus;
  notes: string | null;
  outreach_template: string | null;
  contacted_at: string | null;
  added_at: string;
  lead?: Lead; // joined
}

// ── Business Analyzer types ──────────────────────────────────────────────────
export type AnalysisStatus = "pending" | "analyzing" | "completed" | "failed";

export interface PainPoint {
  id: string;
  label: string;
  severity: "critical" | "high" | "medium" | "low";
  description: string;
  related_offer: string;
}

export interface RecommendedOffer {
  id: string;
  name: string;
  reason: string;
  priority: "high" | "medium" | "low";
  estimated_value: string;
}

export interface CompetitorAnalysis {
  business_name: string;
  google_maps_url: string | null;
  website_url: string | null;
  website_score: number | null;
  rating: number | null;
  review_count: number | null;
  has_meta_ads: boolean;
  facebook_url: string | null;
  instagram_url: string | null;
  strengths: string[];
}

export interface BusinessAnalysis {
  id: string;
  user_id: string;
  lead_id: string | null;

  input_type: "name_city" | "google_maps_url" | "siret";
  input_value: string;

  business_name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  google_maps_url: string | null;

  siren: string | null;
  siret: string | null;
  company_type: string | null;
  creation_date: string | null;
  revenue_bracket: string | null;
  employee_count: string | null;
  owner_name: string | null;
  owner_role: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  linkedin_url: string | null;

  website_url: string | null;
  website_score: number | null;
  website_quality: string | null;
  has_https: boolean;
  has_booking: boolean;
  has_chatbot: boolean;

  google_rating: number | null;
  google_review_count: number | null;
  review_trend: string | null;
  review_highlights: string[];

  facebook_url: string | null;
  facebook_followers: number | null;
  instagram_url: string | null;
  instagram_followers: number | null;
  has_meta_ads: boolean;
  meta_ads_count: number;

  potential_score: number;
  pain_points: PainPoint[];
  recommended_offers: RecommendedOffer[];
  competitors: CompetitorAnalysis[];

  status: AnalysisStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// ── Website Build types ─────────────────────────────────────────────────────
export type WebsiteBuildStatus = "pending" | "generating_foundation" | "generating_pages" | "deploying" | "deployed" | "failed";

export interface WebsiteFile {
  path: string;
  content: string;
}

export interface WebsiteBuild {
  id: string;
  project_id: string;
  variant_id: string;
  status: WebsiteBuildStatus;
  files: WebsiteFile[];
  vercel_url: string | null;
  vercel_deployment_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
