-- Migration 031 — agent_chats : mapping (user → OpenCode session ID).
--
-- The Next.js UI calls /api/lead-agent which proxies to the OpenCode server
-- on the VPS. OpenCode owns the actual conversation state (messages, tool
-- calls, etc.) — we just remember which OpenCode session belongs to which
-- Supabase user.

BEGIN;

CREATE TABLE IF NOT EXISTS public.agent_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opencode_session_id TEXT NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_chats_user_session_unique UNIQUE (user_id, opencode_session_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_chats_user_recent
  ON public.agent_chats (user_id, last_message_at DESC);

ALTER TABLE public.agent_chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_chats_owner_all ON public.agent_chats;
CREATE POLICY agent_chats_owner_all ON public.agent_chats
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_chats TO authenticated;
GRANT ALL ON public.agent_chats TO service_role;

COMMIT;
