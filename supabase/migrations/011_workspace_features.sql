-- CRM, Calendar, Messagerie, Drive, Notifications, Presence
-- All org-scoped via org_id + public.is_org_member(org_id)

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_unread ON public.notifications(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_org ON public.notifications(org_id);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND public.is_org_member(org_id));

CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Inserts via service role (API) or future RPC; prevents forged cross-user notifications
GRANT ALL ON public.notifications TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Presence (messagerie)
-- ---------------------------------------------------------------------------

CREATE TABLE public.user_presence (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'offline' CHECK (state IN ('online', 'busy', 'away', 'offline')),
  custom_status TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "presence_select_org"
  ON public.user_presence FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

CREATE POLICY "presence_upsert_own"
  ON public.user_presence FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.is_org_member(org_id));

CREATE POLICY "presence_update_own"
  ON public.user_presence FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND public.is_org_member(org_id));

GRANT ALL ON public.user_presence TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- CRM
-- ---------------------------------------------------------------------------

CREATE TABLE public.crm_pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Sales',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES public.crm_pipelines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#6366f1'
);

CREATE TABLE public.deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES public.crm_pipelines(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES public.crm_stages(id) ON DELETE RESTRICT,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  niche TEXT,
  value_cents BIGINT,
  currency TEXT DEFAULT 'EUR',
  tags TEXT[] NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  lost_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deals_org ON public.deals(org_id);
CREATE INDEX idx_deals_stage ON public.deals(stage_id);
CREATE INDEX idx_deals_lead ON public.deals(lead_id);

CREATE TABLE public.deal_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('note', 'stage_change', 'call', 'meeting', 'file', 'system')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deal_activities_deal ON public.deal_activities(deal_id);

CREATE TABLE public.deal_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  linked_type TEXT NOT NULL CHECK (linked_type IN ('drive_node', 'calendar_event', 'telephony_call')),
  linked_id UUID NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deal_id, linked_type, linked_id)
);

ALTER TABLE public.telephony_calls
  ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_telephony_calls_deal ON public.telephony_calls(deal_id);

-- CRM RLS
ALTER TABLE public.crm_pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_pipelines_org" ON public.crm_pipelines FOR ALL TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "crm_stages_org" ON public.crm_stages FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.crm_pipelines p WHERE p.id = crm_stages.pipeline_id AND public.is_org_member(p.org_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.crm_pipelines p WHERE p.id = crm_stages.pipeline_id AND public.is_org_member(p.org_id))
  );

CREATE POLICY "deals_org" ON public.deals FOR ALL TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "deal_activities_org" ON public.deal_activities FOR ALL TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "deal_links_org" ON public.deal_links FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_links.deal_id AND public.is_org_member(d.org_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_links.deal_id AND public.is_org_member(d.org_id))
  );

GRANT ALL ON public.crm_pipelines TO authenticated, service_role;
GRANT ALL ON public.crm_stages TO authenticated, service_role;
GRANT ALL ON public.deals TO authenticated, service_role;
GRANT ALL ON public.deal_activities TO authenticated, service_role;
GRANT ALL ON public.deal_links TO authenticated, service_role;

-- Seed default pipeline for default org
INSERT INTO public.crm_pipelines (id, org_id, name, is_default)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'Sales',
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.crm_stages (pipeline_id, name, sort_order, color)
SELECT s.pipeline_id, s.name, s.sort_order, s.color
FROM (
  VALUES
    ('10000000-0000-4000-8000-000000000001'::uuid, 'New lead', 0, '#94a3b8'),
    ('10000000-0000-4000-8000-000000000001', 'Contacted', 1, '#38bdf8'),
    ('10000000-0000-4000-8000-000000000001', 'Demo scheduled', 2, '#a78bfa'),
    ('10000000-0000-4000-8000-000000000001', 'Demo done', 3, '#818cf8'),
    ('10000000-0000-4000-8000-000000000001', 'Quote sent', 4, '#fbbf24'),
    ('10000000-0000-4000-8000-000000000001', 'Signed', 5, '#34d399'),
    ('10000000-0000-4000-8000-000000000001', 'Delivered', 6, '#22c55e')
) AS s(pipeline_id, name, sort_order, color)
WHERE EXISTS (SELECT 1 FROM public.crm_pipelines p WHERE p.id = s.pipeline_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.crm_stages x WHERE x.pipeline_id = s.pipeline_id
  );

-- ---------------------------------------------------------------------------
-- Calendar
-- ---------------------------------------------------------------------------

CREATE TABLE public.calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL DEFAULT 'internal' CHECK (event_type IN (
    'prospect_call', 'demo', 'internal', 'deadline', 'focus_block', 'callback', 'other'
  )),
  visibility TEXT NOT NULL DEFAULT 'org' CHECK (visibility IN ('private', 'org', 'selected_users')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  all_day BOOLEAN NOT NULL DEFAULT false,
  location TEXT,
  video_link TEXT,
  recurrence_rule TEXT,
  recurrence_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.calendar_event_attendees (
  event_id UUID NOT NULL REFERENCES public.calendar_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  response_status TEXT NOT NULL DEFAULT 'pending' CHECK (response_status IN ('pending', 'accepted', 'declined', 'tentative')),
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE public.calendar_event_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.calendar_events(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('lead', 'deal', 'telephony_call', 'drive_node')),
  entity_id UUID NOT NULL,
  UNIQUE (event_id, entity_type, entity_id)
);

CREATE TABLE public.calendar_event_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.calendar_events(id) ON DELETE CASCADE,
  original_starts_at TIMESTAMPTZ NOT NULL,
  override_starts_at TIMESTAMPTZ,
  override_ends_at TIMESTAMPTZ,
  cancelled BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE public.calendar_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.calendar_events(id) ON DELETE CASCADE,
  offset_minutes INTEGER NOT NULL,
  channel TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'email', 'push'))
);

CREATE TABLE public.calendar_out_of_office (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.booking_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT 'Book time',
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  buffer_minutes INTEGER NOT NULL DEFAULT 10,
  min_notice_hours INTEGER NOT NULL DEFAULT 24,
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_calendar_events_org_time ON public.calendar_events(org_id, starts_at);

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_event_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_event_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_event_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_out_of_office ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calendar_events_select"
  ON public.calendar_events FOR SELECT TO authenticated
  USING (
    public.is_org_member(org_id)
    AND (
      visibility = 'org'
      OR created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.calendar_event_attendees a
        WHERE a.event_id = calendar_events.id AND a.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "calendar_events_mutate"
  ON public.calendar_events FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(org_id) AND auth.uid() = created_by);

CREATE POLICY "calendar_events_update"
  ON public.calendar_events FOR UPDATE TO authenticated
  USING (public.is_org_member(org_id) AND created_by = auth.uid())
  WITH CHECK (public.is_org_member(org_id) AND created_by = auth.uid());

CREATE POLICY "calendar_events_delete"
  ON public.calendar_events FOR DELETE TO authenticated
  USING (public.is_org_member(org_id) AND created_by = auth.uid());

CREATE POLICY "calendar_attendees_all"
  ON public.calendar_event_attendees FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.calendar_events e
      WHERE e.id = calendar_event_attendees.event_id AND public.is_org_member(e.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.calendar_events e
      WHERE e.id = calendar_event_attendees.event_id AND public.is_org_member(e.org_id)
    )
  );

CREATE POLICY "calendar_links_all"
  ON public.calendar_event_links FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.calendar_events e
      WHERE e.id = calendar_event_links.event_id AND public.is_org_member(e.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.calendar_events e
      WHERE e.id = calendar_event_links.event_id AND public.is_org_member(e.org_id)
    )
  );

CREATE POLICY "calendar_exceptions_all"
  ON public.calendar_event_exceptions FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.calendar_events e
      WHERE e.id = calendar_event_exceptions.event_id AND public.is_org_member(e.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.calendar_events e
      WHERE e.id = calendar_event_exceptions.event_id AND public.is_org_member(e.org_id)
    )
  );

CREATE POLICY "calendar_reminders_all"
  ON public.calendar_reminders FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.calendar_events e
      WHERE e.id = calendar_reminders.event_id AND public.is_org_member(e.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.calendar_events e
      WHERE e.id = calendar_reminders.event_id AND public.is_org_member(e.org_id)
    )
  );

CREATE POLICY "ooo_org"
  ON public.calendar_out_of_office FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "booking_links_org"
  ON public.booking_links FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id) AND auth.uid() = user_id);

GRANT ALL ON public.calendar_events TO authenticated, service_role;
GRANT ALL ON public.calendar_event_attendees TO authenticated, service_role;
GRANT ALL ON public.calendar_event_links TO authenticated, service_role;
GRANT ALL ON public.calendar_event_exceptions TO authenticated, service_role;
GRANT ALL ON public.calendar_reminders TO authenticated, service_role;
GRANT ALL ON public.calendar_out_of_office TO authenticated, service_role;
GRANT ALL ON public.booking_links TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Messagerie
-- ---------------------------------------------------------------------------

CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('dm', 'group', 'channel')),
  title TEXT,
  slug TEXT,
  is_private BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DM pair uniqueness enforced in app; channels unique slug per org
CREATE UNIQUE INDEX idx_conversations_channel_slug ON public.conversations(org_id, slug)
  WHERE type = 'channel' AND slug IS NOT NULL;

CREATE TABLE public.conversation_members (
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  last_read_at TIMESTAMPTZ,
  muted_until TIMESTAMPTZ,
  notify_policy TEXT NOT NULL DEFAULT 'all' CHECK (notify_policy IN ('all', 'mentions', 'none')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  embeds JSONB NOT NULL DEFAULT '[]'::jsonb,
  reply_to_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  root_message_id UUID REFERENCES public.messages(id) ON DELETE CASCADE,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_messages_conversation ON public.messages(conversation_id, created_at DESC);

CREATE TABLE public.message_reactions (
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE public.pinned_messages (
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  pinned_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, message_id)
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pinned_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversations_member_select"
  ON public.conversations FOR SELECT TO authenticated
  USING (
    public.is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM public.conversation_members m
      WHERE m.conversation_id = conversations.id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "conversations_insert"
  ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(org_id) AND auth.uid() = created_by);

CREATE POLICY "conversations_update_owner"
  ON public.conversations FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_members m
      WHERE m.conversation_id = conversations.id AND m.user_id = auth.uid() AND m.role = 'owner'
    )
  );

CREATE POLICY "conversation_members_select_self"
  ON public.conversation_members FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_members.conversation_id AND public.is_org_member(c.org_id)
    )
    AND (
      conversation_members.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.conversation_members m2
        WHERE m2.conversation_id = conversation_members.conversation_id AND m2.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "conversation_members_insert"
  ON public.conversation_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_members.conversation_id
        AND c.created_by = auth.uid()
        AND public.is_org_member(c.org_id)
    )
  );

CREATE POLICY "conversation_members_update_own"
  ON public.conversation_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "conversation_members_delete_creator"
  ON public.conversation_members FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_members.conversation_id AND c.created_by = auth.uid()
    )
  );

CREATE POLICY "messages_select"
  ON public.messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_members m
      INNER JOIN public.conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = messages.conversation_id AND m.user_id = auth.uid() AND public.is_org_member(c.org_id)
    )
  );

CREATE POLICY "messages_insert"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = author_id
    AND EXISTS (
      SELECT 1 FROM public.conversation_members m
      INNER JOIN public.conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = messages.conversation_id AND m.user_id = auth.uid() AND public.is_org_member(c.org_id)
    )
  );

CREATE POLICY "messages_update_own"
  ON public.messages FOR UPDATE TO authenticated
  USING (auth.uid() = author_id)
  WITH CHECK (auth.uid() = author_id);

CREATE POLICY "reactions_select"
  ON public.message_reactions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.messages msg
      INNER JOIN public.conversation_members m ON m.conversation_id = msg.conversation_id
      WHERE msg.id = message_reactions.message_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "reactions_insert"
  ON public.message_reactions FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.messages msg
      INNER JOIN public.conversation_members m ON m.conversation_id = msg.conversation_id
      WHERE msg.id = message_reactions.message_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "reactions_delete_own"
  ON public.message_reactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "pinned_all"
  ON public.pinned_messages FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_members m
      WHERE m.conversation_id = pinned_messages.conversation_id AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversation_members m
      WHERE m.conversation_id = pinned_messages.conversation_id AND m.user_id = auth.uid()
    )
  );

GRANT ALL ON public.conversations TO authenticated, service_role;
GRANT ALL ON public.conversation_members TO authenticated, service_role;
GRANT ALL ON public.messages TO authenticated, service_role;
GRANT ALL ON public.message_reactions TO authenticated, service_role;
GRANT ALL ON public.pinned_messages TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.add_conversation_creator_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (new.id, new.created_by, 'owner');
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS conversations_creator_member ON public.conversations;
CREATE TRIGGER conversations_creator_member
  AFTER INSERT ON public.conversations
  FOR EACH ROW EXECUTE PROCEDURE public.add_conversation_creator_member();

-- ---------------------------------------------------------------------------
-- Drive
-- ---------------------------------------------------------------------------

CREATE TABLE public.drive_spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('personal', 'shared')),
  name TEXT NOT NULL,
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.drive_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  space_id UUID NOT NULL REFERENCES public.drive_spaces(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.drive_nodes(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('folder', 'page', 'file', 'database', 'table_sheet')),
  title TEXT NOT NULL DEFAULT 'Untitled',
  sort_order INTEGER NOT NULL DEFAULT 0,
  content JSONB,
  file_path TEXT,
  mime TEXT,
  size_bytes BIGINT,
  color_label TEXT,
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_drive_nodes_space_parent ON public.drive_nodes(space_id, parent_id) WHERE deleted_at IS NULL;

CREATE TABLE public.drive_page_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES public.drive_nodes(id) ON DELETE CASCADE,
  content JSONB NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.drive_acl (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES public.drive_nodes(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('view', 'comment', 'edit', 'admin')),
  UNIQUE (node_id, user_id)
);

CREATE TABLE public.drive_stars (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES public.drive_nodes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, node_id)
);

CREATE TABLE public.drive_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  UNIQUE (org_id, name)
);

CREATE TABLE public.drive_node_tags (
  node_id UUID NOT NULL REFERENCES public.drive_nodes(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.drive_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (node_id, tag_id)
);

CREATE TABLE public.drive_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  source_node_id UUID REFERENCES public.drive_nodes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.drive_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES public.drive_nodes(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.drive_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES public.drive_nodes(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  anchor JSONB,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.drive_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drive_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drive_page_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drive_acl ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drive_stars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drive_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drive_node_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drive_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drive_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drive_comments ENABLE ROW LEVEL SECURITY;

-- Drive access: org member + (shared space OR personal owner)
CREATE POLICY "drive_spaces_select"
  ON public.drive_spaces FOR SELECT TO authenticated
  USING (
    public.is_org_member(org_id)
    AND (kind = 'shared' OR owner_user_id = auth.uid())
  );

CREATE POLICY "drive_spaces_insert"
  ON public.drive_spaces FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(org_id)
    AND (kind = 'shared' OR owner_user_id = auth.uid())
  );

CREATE POLICY "drive_spaces_update"
  ON public.drive_spaces FOR UPDATE TO authenticated
  USING (
    public.is_org_member(org_id)
    AND (kind = 'shared' OR owner_user_id = auth.uid())
  );

CREATE POLICY "drive_nodes_select"
  ON public.drive_nodes FOR SELECT TO authenticated
  USING (
    public.is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM public.drive_spaces s
      WHERE s.id = drive_nodes.space_id
        AND public.is_org_member(s.org_id)
        AND (s.kind = 'shared' OR s.owner_user_id = auth.uid())
    )
  );

CREATE POLICY "drive_nodes_insert"
  ON public.drive_nodes FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM public.drive_spaces s
      WHERE s.id = drive_nodes.space_id
        AND (s.kind = 'shared' OR s.owner_user_id = auth.uid())
    )
  );

CREATE POLICY "drive_nodes_update"
  ON public.drive_nodes FOR UPDATE TO authenticated
  USING (
    public.is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM public.drive_spaces s
      WHERE s.id = drive_nodes.space_id
        AND (s.kind = 'shared' OR s.owner_user_id = auth.uid())
    )
  );

CREATE POLICY "drive_nodes_delete"
  ON public.drive_nodes FOR DELETE TO authenticated
  USING (
    public.is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM public.drive_spaces s
      WHERE s.id = drive_nodes.space_id
        AND (s.kind = 'shared' OR s.owner_user_id = auth.uid())
    )
  );

CREATE POLICY "drive_revisions_all"
  ON public.drive_page_revisions FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.drive_nodes n
      WHERE n.id = drive_page_revisions.node_id AND public.is_org_member(n.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.drive_nodes n
      WHERE n.id = drive_page_revisions.node_id AND public.is_org_member(n.org_id)
    )
  );

CREATE POLICY "drive_acl_all"
  ON public.drive_acl FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.drive_nodes n
      WHERE n.id = drive_acl.node_id AND public.is_org_member(n.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.drive_nodes n
      WHERE n.id = drive_acl.node_id AND public.is_org_member(n.org_id)
    )
  );

CREATE POLICY "drive_stars_own"
  ON public.drive_stars FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "drive_tags_org"
  ON public.drive_tags FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "drive_node_tags_all"
  ON public.drive_node_tags FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.drive_nodes n
      WHERE n.id = drive_node_tags.node_id AND public.is_org_member(n.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.drive_nodes n
      WHERE n.id = drive_node_tags.node_id AND public.is_org_member(n.org_id)
    )
  );

CREATE POLICY "drive_templates_org"
  ON public.drive_templates FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "drive_share_links_authenticated"
  ON public.drive_share_links FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.drive_nodes n
      WHERE n.id = drive_share_links.node_id AND public.is_org_member(n.org_id)
    )
  )
  WITH CHECK (
    auth.uid() = created_by
    AND EXISTS (
      SELECT 1 FROM public.drive_nodes n
      WHERE n.id = drive_share_links.node_id AND public.is_org_member(n.org_id)
    )
  );

CREATE POLICY "drive_comments_all"
  ON public.drive_comments FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.drive_nodes n
      WHERE n.id = drive_comments.node_id AND public.is_org_member(n.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.drive_nodes n
      WHERE n.id = drive_comments.node_id AND public.is_org_member(n.org_id)
    )
  );

GRANT ALL ON public.drive_spaces TO authenticated, service_role;
GRANT ALL ON public.drive_nodes TO authenticated, service_role;
GRANT ALL ON public.drive_page_revisions TO authenticated, service_role;
GRANT ALL ON public.drive_acl TO authenticated, service_role;
GRANT ALL ON public.drive_stars TO authenticated, service_role;
GRANT ALL ON public.drive_tags TO authenticated, service_role;
GRANT ALL ON public.drive_node_tags TO authenticated, service_role;
GRANT ALL ON public.drive_templates TO authenticated, service_role;
GRANT ALL ON public.drive_share_links TO authenticated, service_role;
GRANT ALL ON public.drive_comments TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Realtime (Supabase) — ignore if already added
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.user_presence;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Default shared Drive spaces (default org)
INSERT INTO public.drive_spaces (id, org_id, kind, name, purpose)
VALUES
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'shared', 'Sales', 'sales'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'shared', 'Clients', 'clients'),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'shared', 'Processes', 'processes'),
  ('20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'shared', 'Resources', 'resources')
ON CONFLICT (id) DO NOTHING;
