-- Fix "permission denied for table business_analyses"
-- 1) Table privileges for Supabase roles (RLS still applies for JWT clients)
-- 2) Allow users to UPDATE their own rows (optional client / consistency)
-- 3) Remove misleading policy — service_role bypasses RLS in the JS client; the old FOR ALL USING (true) was unsafe for authenticated

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_analyses TO authenticated;
GRANT ALL ON public.business_analyses TO service_role;

DROP POLICY IF EXISTS "Service role full access on analyses" ON public.business_analyses;

DROP POLICY IF EXISTS "Users can update own analyses" ON public.business_analyses;
CREATE POLICY "Users can update own analyses"
  ON public.business_analyses FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
