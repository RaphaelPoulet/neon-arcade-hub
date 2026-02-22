import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import GameGrid from "@/components/GameGrid";
import Footer from "@/components/Footer";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        <Hero />
        <GameGrid />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
