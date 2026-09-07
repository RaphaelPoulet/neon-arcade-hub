import { Button } from "@/components/ui/button";
import { Trophy, Medal, Award, RotateCcw, ListVideo, Crosshair } from "lucide-react";
import { FIRE_COOLDOWN, formatTime, type RaceSnapshot } from "./raceCore";

const ORDINAL = ["", "1ST", "2ND", "3RD", "4TH"];

export function RaceHud({ snap }: { snap: RaceSnapshot }) {
  const ready = snap.cooldown <= 0;
  const pct = Math.max(0, Math.min(1, 1 - snap.cooldown / FIRE_COOLDOWN));
  return (
    <div className="pointer-events-none absolute inset-x-0 top-14 flex items-start justify-between px-3">
      <div className="glass rounded-md px-3 py-2 font-pixel text-[9px] leading-5 text-primary">
        <div>
          LAP {snap.lap}/{snap.totalLaps}
        </div>
        <div className="text-secondary">POS {ORDINAL[snap.place]}/4</div>
        <div className="text-foreground/80">{formatTime(snap.elapsed)}</div>
        <div className={`mt-1 flex items-center gap-1 ${ready ? "text-primary" : "text-muted-foreground"}`}>
          <Crosshair className="h-3 w-3" />
          <span>{ready ? "FIRE!" : `${Math.ceil(snap.cooldown)}s`}</span>
        </div>
        <div className="mt-1 h-1 w-20 overflow-hidden rounded-full bg-muted/40">
          <div
            className={`h-full ${ready ? "bg-primary" : "bg-secondary"}`}
            style={{ width: `${pct * 100}%` }}
          />
        </div>
        {snap.spinning && <div className="mt-1 text-secondary">SPIN OUT!</div>}
      </div>
      <div className="glass rounded-md px-3 py-2 font-pixel text-[8px] leading-5">
        {snap.standings.map((s) => (
          <div key={s.id} className="flex items-center gap-2">
            <span className="text-muted-foreground">{s.place}</span>
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
            <span style={{ color: s.name === "YOU" ? undefined : s.color }}>{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}


export function Countdown({ snap }: { snap: RaceSnapshot }) {
  if (snap.status !== "countdown") return null;
  const n = Math.ceil(snap.countdown);
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="font-pixel text-6xl text-primary drop-shadow-[0_0_25px_hsl(var(--primary))]">
        {n > 3 ? 3 : n > 0 ? n : "GO!"}
      </span>
    </div>
  );
}

function PlaceIcon({ place }: { place: number }) {
  if (place === 1) return <Trophy className="h-6 w-6 text-yellow-300" />;
  if (place === 2) return <Medal className="h-5 w-5 text-slate-200" />;
  if (place === 3) return <Award className="h-5 w-5 text-amber-600" />;
  return <span className="inline-block h-5 w-5" />;
}

export function Podium({
  snap,
  onRestart,
  onExit,
}: {
  snap: RaceSnapshot;
  onRestart: () => void;
  onExit: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="glass neon-border-cyan w-[min(92%,460px)] rounded-xl p-6 text-center">
        <h2 className="font-pixel text-sm tracking-widest text-primary drop-shadow-[0_0_12px_hsl(var(--primary))]">
          RACE RESULTS
        </h2>
        <div className="mt-5 space-y-2">
          {snap.standings.map((s) => (
            <div
              key={s.id}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
                s.place === 1
                  ? "bg-yellow-300/10 ring-1 ring-yellow-300/50"
                  : s.place === 2
                    ? "bg-slate-200/10"
                    : s.place === 3
                      ? "bg-amber-600/10"
                      : "bg-muted/20"
              }`}
            >
              <PlaceIcon place={s.place} />
              <span className="font-pixel text-[10px] text-muted-foreground">{ORDINAL[s.place]}</span>
              <span
                className="flex-1 text-left font-pixel text-[10px]"
                style={{ color: s.name === "YOU" ? "hsl(var(--primary))" : s.color }}
              >
                {s.name}
              </span>
              <span className="font-pixel text-[9px] text-foreground/80">
                {s.finished ? formatTime(s.time) : "DNF"}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-6 flex justify-center gap-3">
          <Button
            onClick={onRestart}
            className="glass neon-border-cyan font-pixel text-[9px] text-primary hover:neon-glow-cyan"
            variant="outline"
          >
            <RotateCcw className="mr-2 h-3 w-3" />
            RESTART
          </Button>
          <Button
            onClick={onExit}
            className="glass font-pixel text-[9px] text-secondary"
            variant="outline"
          >
            <ListVideo className="mr-2 h-3 w-3" />
            TRACKS
          </Button>
        </div>
      </div>
    </div>
  );
}
