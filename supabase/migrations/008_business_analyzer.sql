-- Business Analyzer reports
CREATE TABLE IF NOT EXISTS business_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  lead_id UUID REFERENCES leads(id),

  input_type TEXT NOT NULL CHECK (input_type IN ('name_city', 'google_maps_url', 'siret')),
  input_value TEXT NOT NULL,

  business_name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  email TEXT,
  google_maps_url TEXT,

  siren TEXT,
  siret TEXT,
  company_type TEXT,
  creation_date TEXT,
  revenue_bracket TEXT,
  employee_count TEXT,
  owner_name TEXT,
  owner_role TEXT,
  owner_phone TEXT,
  owner_email TEXT,
  linkedin_url TEXT,

  website_url TEXT,
  website_score INTEGER,
  website_quality TEXT,
  has_https BOOLEAN DEFAULT FALSE,
  has_booking BOOLEAN DEFAULT FALSE,
  has_chatbot BOOLEAN DEFAULT FALSE,

  google_rating NUMERIC,
  google_review_count INTEGER,
  review_trend TEXT,
  review_highlights JSONB DEFAULT '[]',

  facebook_url TEXT,
  facebook_followers INTEGER,
  instagram_url TEXT,
  instagram_followers INTEGER,
  has_meta_ads BOOLEAN DEFAULT FALSE,
  meta_ads_count INTEGER DEFAULT 0,

  potential_score INTEGER,
  pain_points JSONB DEFAULT '[]',
  recommended_offers JSONB DEFAULT '[]',
  competitors JSONB DEFAULT '[]',

  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'analyzing', 'completed', 'failed')),
  error TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Extend leads with V2 enrichment columns
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_https BOOLEAN;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_booking BOOLEAN;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_chatbot BOOLEAN;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_meta_ads BOOLEAN;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_ads_count INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS potential_score INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS pain_points JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS recommended_offers JSONB;

-- RLS for business_analyses
ALTER TABLE business_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own analyses"
  ON business_analyses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own analyses"
  ON business_analyses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access on analyses"
  ON business_analyses FOR ALL
  USING (true)
  WITH CHECK (true);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_business_analyses_user ON business_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_business_analyses_lead ON business_analyses(lead_id);
CREATE INDEX IF NOT EXISTS idx_business_analyses_status ON business_analyses(status);
