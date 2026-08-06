-- Playlist: allow management without a Supabase auth session (client-side admin gate only)
DROP POLICY IF EXISTS "Admins can insert tracks" ON public.playlist;
DROP POLICY IF EXISTS "Admins can update tracks" ON public.playlist;
DROP POLICY IF EXISTS "Admins can delete tracks" ON public.playlist;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.playlist TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.playlist TO authenticated;
GRANT ALL ON public.playlist TO service_role;

CREATE POLICY "Anyone can insert tracks"
  ON public.playlist FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Anyone can update tracks"
  ON public.playlist FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can delete tracks"
  ON public.playlist FOR DELETE TO anon, authenticated USING (true);

-- Music storage bucket: allow uploads/reads/deletes for the same flow
DROP POLICY IF EXISTS "Music read" ON storage.objects;
DROP POLICY IF EXISTS "Music insert" ON storage.objects;
DROP POLICY IF EXISTS "Music update" ON storage.objects;
DROP POLICY IF EXISTS "Music delete" ON storage.objects;

CREATE POLICY "Music read"
  ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'music');

CREATE POLICY "Music insert"
  ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'music');

CREATE POLICY "Music update"
  ON storage.objects FOR UPDATE TO anon, authenticated USING (bucket_id = 'music') WITH CHECK (bucket_id = 'music');

CREATE POLICY "Music delete"
  ON storage.objects FOR DELETE TO anon, authenticated USING (bucket_id = 'music');