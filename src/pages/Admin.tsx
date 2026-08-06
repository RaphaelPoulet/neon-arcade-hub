import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Music2, Plus, Trash2, Upload } from "lucide-react";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { STORAGE_PREFIX } from "@/lib/trackUrl";
import { toast } from "sonner";

interface Track {
  id: string;
  title: string;
  url: string;
  created_at: string;
}

const Admin = () => {
  const { user, isAdmin, loading } = useAuth();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("playlist")
      .select("id, title, url, created_at")
      .order("created_at", { ascending: false });
    setTracks(data ?? []);
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const addTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return toast.error("Track title is required");
    if (!file && !url.trim()) return toast.error("Provide an audio URL or a file");

    setBusy(true);
    let finalUrl = url.trim();

    if (file) {
      const path = `${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("music").upload(path, file);
      if (upErr) {
        setBusy(false);
        return toast.error(upErr.message);
      }
      finalUrl = `${STORAGE_PREFIX}${path}`;
    }

    const { error } = await supabase.from("playlist").insert({ title: t, url: finalUrl });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Track added");
    setTitle(""); setUrl(""); setFile(null);
    load();
  };

  const removeTrack = async (track: Track) => {
    const { error } = await supabase.from("playlist").delete().eq("id", track.id);
    if (error) return toast.error(error.message);
    if (track.url.startsWith(STORAGE_PREFIX)) {
      await supabase.storage.from("music").remove([track.url.slice(STORAGE_PREFIX.length)]);
    }
    toast.success("Track removed");
    load();
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-24 pb-16 container mx-auto px-4 max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <Music2 className="w-6 h-6 text-secondary" />
          <h1 className="font-pixel text-lg text-secondary neon-text-pink">Music Admin</h1>
        </div>

        {loading ? (
          <p className="font-pixel text-[10px] text-muted-foreground">LOADING...</p>
        ) : !isAdmin ? (
          <div className="glass rounded-xl p-6 border border-border/50 text-center">
            <p className="font-pixel text-[10px] text-destructive mb-2">ACCESS DENIED</p>
            <p className="text-sm text-muted-foreground">
              This panel is reserved for administrators.
            </p>
          </div>
        ) : (
          <>
            <form onSubmit={addTrack} className="glass rounded-xl p-4 border border-border/50 space-y-3 mb-8">
              <div>
                <label className="font-pixel text-[9px] text-muted-foreground block mb-1">TITLE</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  placeholder="Neon Highway"
                  className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="font-pixel text-[9px] text-muted-foreground block mb-1">AUDIO URL</label>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  maxLength={2000}
                  placeholder="https://..."
                  className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="font-pixel text-[9px] text-muted-foreground block mb-1 flex items-center gap-1">
                  <Upload className="w-3 h-3" /> OR UPLOAD FILE
                </label>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/20 file:px-3 file:py-1.5 file:text-primary file:font-pixel file:text-[8px]"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 bg-secondary text-secondary-foreground font-pixel text-[10px] py-3 rounded-lg neon-glow-pink hover:scale-[1.02] active:scale-95 transition-transform disabled:opacity-50"
              >
                <Plus className="w-4 h-4" /> {busy ? "SAVING..." : "ADD TRACK"}
              </button>
            </form>

            <div className="space-y-2">
              {tracks.length === 0 ? (
                <p className="font-pixel text-[10px] text-muted-foreground text-center">PLAYLIST EMPTY</p>
              ) : (
                tracks.map((t) => (
                  <div key={t.id} className="glass rounded-lg p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">{t.title}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{t.url}</p>
                    </div>
                    <button
                      onClick={() => removeTrack(t)}
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      title="Delete track"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        <Link to="/" className="inline-flex items-center gap-2 text-primary hover:text-secondary transition-colors mt-8">
          <ArrowLeft className="w-4 h-4" /> Back to Lobby
        </Link>
      </main>
    </div>
  );
};

export default Admin;
