-- Org-scoped secrets for headless Playwright (session cookies, optional basic auth metadata).
-- Values are encrypted at the application layer (same AES-GCM as user_connections).

CREATE TABLE IF NOT EXISTS public.org_browser_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  hostname TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'cookies'
    CHECK (kind IN ('cookies', 'basic_auth')),
  secret_ciphertext TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_browser_credentials_org
  ON public.org_browser_credentials (org_id);

CREATE INDEX IF NOT EXISTS idx_org_browser_credentials_host
  ON public.org_browser_credentials (org_id, lower(hostname));

ALTER TABLE public.org_browser_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_browser_credentials_select ON public.org_browser_credentials;
CREATE POLICY org_browser_credentials_select ON public.org_browser_credentials
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS org_browser_credentials_insert ON public.org_browser_credentials;
CREATE POLICY org_browser_credentials_insert ON public.org_browser_credentials
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(org_id) AND auth.uid() = created_by);

DROP POLICY IF EXISTS org_browser_credentials_update ON public.org_browser_credentials;
CREATE POLICY org_browser_credentials_update ON public.org_browser_credentials
  FOR UPDATE TO authenticated
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS org_browser_credentials_delete ON public.org_browser_credentials;
CREATE POLICY org_browser_credentials_delete ON public.org_browser_credentials
  FOR DELETE TO authenticated
  USING (public.is_org_member(org_id));

GRANT ALL ON public.org_browser_credentials TO service_role;
