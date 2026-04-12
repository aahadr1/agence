-- Lead Generator tables
-- Stores search sessions and discovered leads (businesses without websites)

-- Drop existing tables/policies if they exist (idempotent)
DROP TABLE IF EXISTS leads CASCADE;
DROP TABLE IF EXISTS lead_searches CASCADE;

-- Lead search sessions
CREATE TABLE lead_searches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  niche TEXT NOT NULL,
  location TEXT NOT NULL,
  status TEXT DEFAULT 'searching' CHECK (status IN ('searching', 'analyzing', 'completed', 'failed')),
  raw_research TEXT,
  leads_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Individual leads found
CREATE TABLE leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  search_id UUID REFERENCES lead_searches(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  business_name TEXT NOT NULL,
  description TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  rating TEXT,
  review_count TEXT,
  review_highlights TEXT[],
  niche TEXT,
  location TEXT,
  source TEXT,
  has_website BOOLEAN DEFAULT false,
  website_url TEXT,
  google_maps_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS policies
ALTER TABLE lead_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own searches" ON lead_searches
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own searches" ON lead_searches
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own searches" ON lead_searches
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own leads" ON leads
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own leads" ON leads
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own leads" ON leads
  FOR DELETE USING (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX idx_leads_search_id ON leads(search_id);
CREATE INDEX idx_lead_searches_user_id ON lead_searches(user_id);
