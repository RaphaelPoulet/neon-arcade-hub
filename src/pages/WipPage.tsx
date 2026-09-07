import { Suspense, useCallback, useState } from "react";
import Navbar from "@/components/Navbar";
import NeonCityScene from "@/components/wip/NeonCityScene";
import TrackSelectMenu, { type TrackId } from "@/components/wip/TrackSelectMenu";
import { RaceHud, Countdown, Podium } from "@/components/wip/RaceOverlay";
import type { RaceSnapshot } from "@/components/wip/raceCore";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";

const WipPage = () => {
  const [track, setTrack] = useState<TrackId | null>(null);
  const [run, setRun] = useState(0);
  const [snap, setSnap] = useState<RaceSnapshot | null>(null);

  const onSnapshot = useCallback((s: RaceSnapshot) => setSnap(s), []);

  const restart = () => {
    setSnap(null);
    setRun((r) => r + 1);
  };

  const exit = () => {
    setSnap(null);
    setTrack(null);
  };

  const sceneKey = `${track}-${run}`;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        <section className="container mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold tracking-widest text-primary">WIP RACING</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {track
              ? "W / Up = accelerate · S / Down = brake · A / D = steer · SPACE = fire (10s reload) · 3 laps vs VOLT, AMPER & HEX"
              : "Choose a circuit to start the session."}
          </p>

          <div className="relative mt-4 h-[70vh] w-full overflow-hidden rounded-xl border border-primary/30 shadow-[0_0_40px_-10px_hsl(var(--primary))]">
            {track ? (
              <>
                <Suspense fallback={null}>
                  <NeonCityScene key={sceneKey} onSnapshot={onSnapshot} />
                </Suspense>

                {snap && <RaceHud snap={snap} />}
                {snap && <Countdown snap={snap} />}

                <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={exit}
                    className="pointer-events-auto glass neon-border-cyan font-pixel text-[9px] text-primary hover:neon-glow-cyan"
                  >
                    <ChevronLeft className="mr-1 h-3 w-3" />
                    CHANGE TRACK
                  </Button>
                  <span className="glass rounded-md px-3 py-1 font-pixel text-[9px] uppercase text-secondary">
                    {track}
                  </span>
                </div>

                {snap?.status === "finished" && (
                  <Podium snap={snap} onRestart={restart} onExit={exit} />
                )}
              </>
            ) : (
              <TrackSelectMenu onSelect={setTrack} />
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

export default WipPage;
