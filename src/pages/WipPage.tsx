import { Suspense } from "react";
import Navbar from "@/components/Navbar";
import WipScene from "@/components/wip/WipScene";

const WipPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        <section className="container mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold tracking-widest text-primary">WIP — 3D PROTOTYPE</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            W / Up = forward · S / Down = backward · A / D or Left / Right = turn in place
          </p>
          <div className="mt-4 h-[70vh] w-full overflow-hidden rounded-xl border border-primary/30 shadow-[0_0_40px_-10px_hsl(var(--primary))]">
            <Suspense fallback={null}>
              <WipScene />
            </Suspense>
          </div>
        </section>
      </main>
    </div>
  );
};

export default WipPage;
