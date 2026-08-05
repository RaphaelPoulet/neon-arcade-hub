CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Roles are viewable by everyone" ON public.user_roles FOR SELECT USING (true);
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.playlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.playlist TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.playlist TO authenticated;
GRANT ALL ON public.playlist TO service_role;

ALTER TABLE public.playlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Playlist is viewable by everyone" ON public.playlist FOR SELECT USING (true);
CREATE POLICY "Admins can insert tracks" ON public.playlist FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update tracks" ON public.playlist FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete tracks" ON public.playlist FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_playlist_updated_at BEFORE UPDATE ON public.playlist
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Music files are publicly readable" ON storage.objects FOR SELECT USING (bucket_id = 'music');
CREATE POLICY "Admins can upload music" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'music' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete music" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'music' AND public.has_role(auth.uid(), 'admin'));