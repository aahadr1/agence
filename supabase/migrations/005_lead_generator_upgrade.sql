-- Lead Generator V2 upgrade
-- Extends leads with enrichment, adds lists + outreach tracking

-- 0. Update lead_searches status constraint to include 'enriching'
ALTER TABLE lead_searches DROP CONSTRAINT IF EXISTS lead_searches_status_check;
ALTER TABLE lead_searches ADD CONSTRAINT lead_searches_status_check CHECK (status IN ('searching', 'analyzing', 'enriching', 'completed', 'failed'));

-- 1. Extend leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS website_quality TEXT CHECK (website_quality IN ('none', 'dead', 'outdated', 'poor', 'decent', 'good'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS website_score INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner_phone TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner_email TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner_role TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS siren TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS company_type TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS creation_date TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS revenue_bracket TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS employee_count TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS facebook_url TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS instagram_url TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follower_count INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS enrichment_data JSONB DEFAULT '{}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS enrichment_status TEXT DEFAULT 'pending' CHECK (enrichment_status IN ('pending', 'enriching', 'completed', 'failed'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2. Lead lists
CREATE TABLE lead_lists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  keywords TEXT[] DEFAULT '{}',
  excluded_business_names TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Lead list items (join table)
CREATE TABLE lead_list_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  list_id UUID REFERENCES lead_lists(id) ON DELETE CASCADE NOT NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'responded', 'not_interested')),
  notes TEXT,
  outreach_template TEXT,
  contacted_at TIMESTAMPTZ,
  added_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(list_id, lead_id)
);

-- RLS
ALTER TABLE lead_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own lists" ON lead_lists
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own list items" ON lead_list_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM lead_lists WHERE id = lead_list_items.list_id AND user_id = auth.uid())
  );

-- Grants
GRANT ALL PRIVILEGES ON lead_lists TO anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON lead_list_items TO anon, authenticated, service_role;

-- Indexes
CREATE INDEX idx_lead_lists_user_id ON lead_lists(user_id);
CREATE INDEX idx_lead_list_items_list_id ON lead_list_items(list_id);
CREATE INDEX idx_lead_list_items_lead_id ON lead_list_items(lead_id);
CREATE INDEX idx_leads_enrichment_status ON leads(enrichment_status);
