import { useEffect, useRef, useState, useCallback } from "react";
import { Play, Pause, SkipBack, SkipForward, Music2, ChevronDown, ChevronUp, Volume2, VolumeX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveTrackUrl } from "@/lib/trackUrl";

interface Track {
  id: string;
  title: string;
  url: string;
}

const VOLUME_KEY = "arcade-radio-volume";

const MusicPlayer = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [volume, setVolume] = useState(() => {
    const stored = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(stored) && stored > 0 ? Math.min(stored, 1) : 0.6;
  });
  const [muted, setMuted] = useState(false);
  // Intent to autoplay: true until the user explicitly pauses
  const wantsPlayRef = useRef(true);

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

  // Keep volume in sync with the audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
      audio.muted = muted;
    }
    localStorage.setItem(VOLUME_KEY, String(volume));
  }, [volume, muted]);

  // Load the source whenever the current track changes, and try to play
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const audio = audioRef.current;
      if (!audio || !current) return;
      const src = await resolveTrackUrl(current.url);
      if (cancelled || !src) return;
      audio.src = src;
      audio.volume = volume;
      audio.muted = muted;
      if (wantsPlayRef.current) {
        audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      }
    };
    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // Browser autoplay policy: retry playback on the first user interaction
  useEffect(() => {
    const kick = () => {
      const audio = audioRef.current;
      if (!audio || !wantsPlayRef.current || !audio.src || !audio.paused) return;
      audio.play().then(() => setPlaying(true)).catch(() => {});
    };
    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart"];
    events.forEach((e) => window.addEventListener(e, kick, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, kick));
  }, []);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (playing) {
      wantsPlayRef.current = false;
      audio.pause();
      setPlaying(false);
    } else {
      wantsPlayRef.current = true;
      if (!audio.src) {
        const src = await resolveTrackUrl(current.url);
        if (src) audio.src = src;
      }
      audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  const step = (dir: number) => {
    if (tracks.length === 0) return;
    wantsPlayRef.current = true;
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
              <button onClick={() => step(-1)} aria-label="Previous track" className="text-muted-foreground hover:text-primary transition-colors">
                <SkipBack className="w-4 h-4" />
              </button>
              <button
                onClick={toggle}
                aria-label={playing ? "Pause" : "Play"}
                className="bg-secondary text-secondary-foreground rounded-full p-2 neon-glow-pink hover:scale-105 active:scale-95 transition-transform"
              >
                {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <button onClick={() => step(1)} aria-label="Next track" className="text-muted-foreground hover:text-primary transition-colors">
                <SkipForward className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? "Unmute" : "Mute"}
                className="text-muted-foreground hover:text-primary transition-colors"
              >
                {muted || volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((muted ? 0 : volume) * 100)}
                onChange={(e) => {
                  setMuted(false);
                  setVolume(Number(e.target.value) / 100);
                }}
                aria-label="Volume"
                className="flex-1 h-1 appearance-none rounded-full bg-muted accent-primary cursor-pointer"
              />
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
