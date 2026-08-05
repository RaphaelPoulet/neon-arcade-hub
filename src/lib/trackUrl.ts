import { supabase } from "@/integrations/supabase/client";

/**
 * Playlist tracks store either a plain http(s) URL or an internal
 * "storage:<path>" reference to a file in the private `music` bucket.
 */
export const STORAGE_PREFIX = "storage:";

export const resolveTrackUrl = async (url: string): Promise<string | null> => {
  if (!url.startsWith(STORAGE_PREFIX)) return url;
  const path = url.slice(STORAGE_PREFIX.length);
  const { data } = await supabase.storage.from("music").createSignedUrl(path, 60 * 60 * 6);
  return data?.signedUrl ?? null;
};
