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
  facebook_url: string | null;
  instagram_url: string | null;
  follower_count: number | null;
  enrichment_data: Record<string, unknown>;
  enrichment_status: EnrichmentStatus;
  updated_at: string;
  created_at: string;
}

export interface LeadList {
  id: string;
  user_id: string;
  name: string;
  keywords: string[];
  excluded_business_names: string[];
  created_at: string;
  updated_at: string;
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
