ALTER TABLE public.drive_nodes
  ADD COLUMN IF NOT EXISTS visibility TEXT;

UPDATE public.drive_nodes AS n
SET visibility = CASE
  WHEN EXISTS (
    SELECT 1
    FROM public.drive_spaces AS s
    WHERE s.id = n.space_id
      AND s.kind = 'shared'
  ) THEN 'organization'
  ELSE 'private'
END
WHERE n.visibility IS NULL;

ALTER TABLE public.drive_nodes
  ALTER COLUMN visibility SET DEFAULT 'private';

ALTER TABLE public.drive_nodes
  ALTER COLUMN visibility SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE public.drive_nodes
    ADD CONSTRAINT drive_nodes_visibility_check
    CHECK (visibility IN ('private', 'organization'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_drive_nodes_visibility_updated
  ON public.drive_nodes(visibility, updated_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.drive_templates
  ADD COLUMN IF NOT EXISTS content JSONB;

UPDATE public.drive_templates
SET content = COALESCE(content, '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb)
WHERE content IS NULL;

ALTER TABLE public.drive_templates
  ALTER COLUMN content SET DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb;

ALTER TABLE public.drive_comments
  ADD COLUMN IF NOT EXISTS parent_comment_id UUID REFERENCES public.drive_comments(id) ON DELETE CASCADE;

ALTER TABLE public.drive_comments
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

ALTER TABLE public.drive_comments
  ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_drive_comments_node_parent
  ON public.drive_comments(node_id, parent_comment_id, created_at);
