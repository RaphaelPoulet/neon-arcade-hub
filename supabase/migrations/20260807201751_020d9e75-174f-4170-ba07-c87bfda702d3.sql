ALTER TABLE public.playlist ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;

WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at ASC) AS rn FROM public.playlist
)
UPDATE public.playlist p SET position = o.rn FROM ordered o WHERE p.id = o.id;

CREATE INDEX IF NOT EXISTS playlist_position_idx ON public.playlist (position);