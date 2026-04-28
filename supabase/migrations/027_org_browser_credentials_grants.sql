-- The RLS policies in 023_org_browser_credentials target authenticated users,
-- but table privileges were only granted to service_role. Without these grants,
-- Postgres rejects authenticated requests before RLS policies can evaluate.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_browser_credentials TO authenticated;
GRANT ALL ON public.org_browser_credentials TO service_role;
