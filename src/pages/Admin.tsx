import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowDown, ArrowUp, Check, Music2, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { STORAGE_PREFIX } from "@/lib/trackUrl";
import { toast } from "sonner";

interface Track {
  id: string;
  title: string;
  url: string;
  position: number;
  created_at: string;
}

const Admin = () => {
  const { isAdmin, loading } = useAuth();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("playlist")
      .select("id, title, url, position, created_at")
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
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

    const nextPos = tracks.length ? Math.max(...tracks.map((t) => t.position)) + 1 : 1;
    const { error } = await supabase.from("playlist").insert({ title: t, url: finalUrl, position: nextPos });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Track added");
    setTitle(""); setUrl(""); setFile(null);
    load();
  };

  const saveTitle = async (track: Track) => {
    const t = editTitle.trim();
    if (!t) return toast.error("Title cannot be empty");
    const { error } = await supabase.from("playlist").update({ title: t }).eq("id", track.id);
    if (error) return toast.error(error.message);
    setEditingId(null);
    toast.success("Title updated");
    load();
  };

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= tracks.length) return;
    const a = tracks[index];
    const b = tracks[target];
    const next = [...tracks];
    next[index] = b; next[target] = a;
    setTracks(next);
    const [r1, r2] = await Promise.all([
      supabase.from("playlist").update({ position: b.position }).eq("id", a.id),
      supabase.from("playlist").update({ position: a.position }).eq("id", b.id),
    ]);
    if (r1.error || r2.error) {
      toast.error(r1.error?.message ?? r2.error?.message ?? "Could not reorder");
    }
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
                tracks.map((t, i) => (
                  <div key={t.id} className="glass rounded-lg p-3 flex items-center gap-3">
                    <div className="flex flex-col shrink-0">
                      <button
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        title="Move up"
                        className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-25"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => move(i, 1)}
                        disabled={i === tracks.length - 1}
                        title="Move down"
                        className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-25"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                    </div>

                    <span className="font-pixel text-[9px] text-primary shrink-0 w-6">
                      {String(i + 1).padStart(2, "0")}
                    </span>

                    <div className="min-w-0 flex-1">
                      {editingId === t.id ? (
                        <input
                          autoFocus
                          value={editTitle}
                          maxLength={120}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveTitle(t);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="w-full bg-muted/50 border border-primary/60 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      ) : (
                        <p className="text-sm text-foreground truncate">{t.title}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground truncate">{t.url}</p>
                    </div>

                    {editingId === t.id ? (
                      <>
                        <button
                          onClick={() => saveTitle(t)}
                          className="text-muted-foreground hover:text-primary transition-colors shrink-0"
                          title="Save title"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                          title="Cancel"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => { setEditingId(t.id); setEditTitle(t.title); }}
                        className="text-muted-foreground hover:text-primary transition-colors shrink-0"
                        title="Rename track"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}

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
