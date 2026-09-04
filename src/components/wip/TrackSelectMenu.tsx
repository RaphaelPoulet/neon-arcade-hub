import { Lock } from "lucide-react";

export type TrackId = "test" | "neon-city-8";

const TRACKS = [
  {
    id: "test" as TrackId,
    name: "TEST",
    subtitle: "Stadium Oval",
    desc: "Two straights, two sweeping curves. Neon asphalt.",
    available: true,
  },
  {
    id: "neon-city-8" as TrackId,
    name: "NEON CITY 8",
    subtitle: "Figure-8 Overpass",
    desc: "A vast figure-eight through a cyberpunk skyline, crossing itself on an elevated bridge.",
    available: true,
  },
  {
    id: "cyber-city",
    name: "CYBER CITY",
    subtitle: "Coming Soon",
    desc: "Rain-slick streets under endless holograms.",
    available: false,
  },
];

interface Props {
  onSelect: (id: TrackId) => void;
}

const TrackSelectMenu = ({ onSelect }: Props) => {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-background via-[hsl(265_45%_12%)] to-background px-4 py-10">
      <h2 className="font-pixel text-xl text-primary neon-text-cyan sm:text-2xl">NEON TRACK SELECTOR</h2>
      <p className="mt-3 font-pixel text-[9px] text-secondary neon-text-pink">SELECT YOUR CIRCUIT</p>

      <div className="mt-8 grid w-full max-w-4xl gap-4 sm:grid-cols-3">
        {TRACKS.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={!t.available}
            onClick={() => t.available && onSelect(t.id as TrackId)}
            className={`glass group relative overflow-hidden rounded-xl p-5 text-left transition-all ${
              t.available
                ? "neon-border-cyan hover:-translate-y-1 hover:neon-glow-cyan"
                : "cursor-not-allowed opacity-40"
            }`}
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
            <div className="flex items-center justify-between">
              <span className="font-pixel text-xs text-foreground">{t.name}</span>
              {!t.available && <Lock className="h-4 w-4 text-muted-foreground" />}
            </div>
            <p className="mt-2 text-xs uppercase tracking-widest text-secondary">{t.subtitle}</p>
            <p className="mt-3 text-xs text-muted-foreground">{t.desc}</p>
            {t.available && (
              <p className="mt-4 font-pixel text-[9px] text-primary neon-text-cyan group-hover:animate-pulse-neon">
                INSERT COIN
              </p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

export default TrackSelectMenu;
