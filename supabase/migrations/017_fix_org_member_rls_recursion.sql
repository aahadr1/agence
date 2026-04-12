-- Fix infinite recursion in is_org_member() (error: stack depth limit exceeded)
-- Root cause:
-- - is_org_member() queries organization_members with SECURITY INVOKER
-- - organization_members RLS policy calls is_org_member()
-- - This circular dependency triggers recursive policy evaluation.
-- Fix: make the function SECURITY DEFINER so it bypasses RLS on organization_members.

CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.org_id = p_org_id AND m.user_id = auth.uid()
  );
$$;
