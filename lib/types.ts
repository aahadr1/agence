export type ProjectStatus = "info_gathering" | "ideation" | "selection" | "completed";

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
