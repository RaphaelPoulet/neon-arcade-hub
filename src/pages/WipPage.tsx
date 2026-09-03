import { Suspense, useState } from "react";
import Navbar from "@/components/Navbar";
import WipScene from "@/components/wip/WipScene";
import TrackSelectMenu, { type TrackId } from "@/components/wip/TrackSelectMenu";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";

const WipPage = () => {
  const [track, setTrack] = useState<TrackId | null>(null);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        <section className="container mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold tracking-widest text-primary">WIP RACING</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {track
              ? "W / Up = accelerate · S / Down = reverse / brake · A / D or Left / Right = steer"
              : "Choose a circuit to start the session."}
          </p>

          <div className="relative mt-4 h-[70vh] w-full overflow-hidden rounded-xl border border-primary/30 shadow-[0_0_40px_-10px_hsl(var(--primary))]">
            {track ? (
              <>
                <Suspense fallback={null}>
                  <WipScene key={track} />
                </Suspense>
                <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTrack(null)}
                    className="pointer-events-auto glass neon-border-cyan font-pixel text-[9px] text-primary hover:neon-glow-cyan"
                  >
                    <ChevronLeft className="mr-1 h-3 w-3" />
                    CHANGE TRACK
                  </Button>
                  <span className="glass rounded-md px-3 py-1 font-pixel text-[9px] uppercase text-secondary">
                    {track}
                  </span>
                </div>
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
