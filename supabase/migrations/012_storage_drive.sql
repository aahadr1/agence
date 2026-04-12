-- Private bucket for Drive file nodes; path: {org_id}/{space_id}/{node_id}/{filename}

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('drive', 'drive', false, 52428800)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "drive_objects_select_org"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'drive'
    AND EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.user_id = auth.uid()
        AND m.org_id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "drive_objects_insert_org"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'drive'
    AND EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.user_id = auth.uid()
        AND m.org_id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "drive_objects_update_org"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'drive'
    AND EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.user_id = auth.uid()
        AND m.org_id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "drive_objects_delete_org"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'drive'
    AND EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.user_id = auth.uid()
        AND m.org_id::text = (storage.foldername(name))[1]
    )
  );
