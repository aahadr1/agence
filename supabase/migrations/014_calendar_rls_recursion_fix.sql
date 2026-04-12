-- Fix infinite recursion in calendar RLS policies (error 42P17)
-- Root cause:
-- - calendar_events SELECT policy checks calendar_event_attendees
-- - calendar_event_attendees policy checks calendar_events
-- This circular dependency triggers recursive policy evaluation.

CREATE OR REPLACE FUNCTION public.is_calendar_event_attendee(
  p_event_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.calendar_event_attendees a
    WHERE a.event_id = p_event_id
      AND a.user_id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_calendar_event_attendee(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_calendar_event_attendee(uuid, uuid)
  TO authenticated, service_role;

DROP POLICY IF EXISTS "calendar_events_select" ON public.calendar_events;

CREATE POLICY "calendar_events_select"
  ON public.calendar_events FOR SELECT TO authenticated
  USING (
    public.is_org_member(org_id)
    AND (
      visibility = 'org'
      OR created_by = auth.uid()
      OR public.is_calendar_event_attendee(id, auth.uid())
    )
  );
