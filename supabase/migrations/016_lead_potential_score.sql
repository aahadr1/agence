-- Ensure potential_score column exists on leads (added in 008 but may be missing in some envs)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS potential_score INTEGER;

-- Index for sorting leads by score (used in lead generator)
CREATE INDEX IF NOT EXISTS idx_leads_potential_score ON leads(potential_score DESC NULLS LAST);
