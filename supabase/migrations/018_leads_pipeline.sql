-- Lead pipeline: qualification, pipeline tracking, follow-up, and prospect analysis columns
-- Run this in the Supabase SQL Editor (idempotent)

-- Enrichment progress tracking
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS enrichment_step TEXT;

-- Prospect analysis (Gemini-generated)
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS prospect_analysis TEXT;

-- Qualification
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS targeted_offer TEXT
  CHECK (targeted_offer IN ('website', 'software', 'ads', 'combo', 'seo', 'other'));
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS identified_need TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS priority_score TEXT DEFAULT 'cold'
  CHECK (priority_score IN ('hot', 'warm', 'cold'));
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS estimated_budget TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS decision_maker_confirmed BOOLEAN DEFAULT false;

-- Pipeline
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS pipeline_status TEXT DEFAULT 'new'
  CHECK (pipeline_status IN (
    'new', 'to_contact', 'contacted', 'responded',
    'demo_sent', 'proposal_sent', 'negotiation', 'won', 'lost', 'not_interested'
  ));
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS first_contact_date DATE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_contact_date DATE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS next_action TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS next_action_date DATE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS contact_channel TEXT
  CHECK (contact_channel IN ('email', 'phone', 'linkedin', 'in_person', 'social', 'other'));

-- Follow-up
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS contact_attempts INTEGER DEFAULT 0;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS demo_site_created BOOLEAN DEFAULT false;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS demo_site_url TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS quote_sent BOOLEAN DEFAULT false;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS quote_amount TEXT;

-- Indexes for common filters
CREATE INDEX IF NOT EXISTS idx_leads_pipeline_status ON public.leads(pipeline_status);
CREATE INDEX IF NOT EXISTS idx_leads_priority_score ON public.leads(priority_score);
CREATE INDEX IF NOT EXISTS idx_leads_next_action_date ON public.leads(next_action_date);
CREATE INDEX IF NOT EXISTS idx_leads_enrichment_step ON public.leads(enrichment_step);
