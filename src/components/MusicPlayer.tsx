import { useEffect, useRef, useState, useCallback } from "react";
import { Play, Pause, SkipBack, SkipForward, Music2, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveTrackUrl } from "@/lib/trackUrl";

interface Track {
  id: string;
  title: string;
  url: string;
}

const MusicPlayer = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const loadTracks = useCallback(async () => {
    const { data } = await supabase
      .from("playlist")
      .select("id, title, url")
      .order("created_at", { ascending: true });
    setTracks(data ?? []);
  }, []);

  useEffect(() => {
    loadTracks();
    const channel = supabase
      .channel("playlist-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "playlist" }, () => loadTracks())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadTracks]);

  const current = tracks[index];

  // Load the source whenever the current track changes
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const audio = audioRef.current;
      if (!audio || !current) return;
      const src = await resolveTrackUrl(current.url);
      if (cancelled || !src) return;
      audio.src = src;
      if (playing) audio.play().catch(() => setPlaying(false));
    };
    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      if (!audio.src) {
        const src = await resolveTrackUrl(current.url);
        if (src) audio.src = src;
      }
      audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  const step = (dir: number) => {
    if (tracks.length === 0) return;
    setIndex((i) => (i + dir + tracks.length) % tracks.length);
  };

  if (tracks.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[80] w-[260px]">
      <audio ref={audioRef} onEnded={() => step(1)} />
      <div className="glass rounded-xl border border-border/50 neon-glow-cyan overflow-hidden">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="w-full flex items-center gap-2 px-3 py-2 text-primary"
        >
          <Music2 className="w-4 h-4" />
          <span className="font-pixel text-[8px] flex-1 text-left">ARCADE RADIO</span>
          {collapsed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        {!collapsed && (
          <div className="px-3 pb-3">
            <p className="text-[11px] text-foreground truncate mb-2">{current?.title}</p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => step(-1)} className="text-muted-foreground hover:text-primary transition-colors">
                <SkipBack className="w-4 h-4" />
              </button>
              <button
                onClick={toggle}
                className="bg-secondary text-secondary-foreground rounded-full p-2 neon-glow-pink hover:scale-105 active:scale-95 transition-transform"
              >
                {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <button onClick={() => step(1)} className="text-muted-foreground hover:text-primary transition-colors">
                <SkipForward className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[8px] font-pixel text-muted-foreground text-center mt-2">
              {index + 1}/{tracks.length}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MusicPlayer;
