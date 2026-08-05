import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import Navbar from "@/components/Navbar";
import NeonPinballGame from "@/components/NeonPinballGame";
import GameLeaderboardPanel from "@/components/GameLeaderboardPanel";

const NeonPinballPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-20 pb-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="container mx-auto px-4"
        >
          <div className="text-center mb-6">
            <h1 className="font-pixel text-lg sm:text-xl text-secondary neon-text-pink mb-2">
              Neon Pinball
            </h1>
            <p className="text-sm text-muted-foreground">
              Classic arcade physics · 3 balls · Hold SPACE to charge the plunger
            </p>
          </div>

          <div className="flex flex-col lg:flex-row gap-6 items-start justify-center">
            <div className="flex-1 min-w-0 w-full">
              <NeonPinballGame />
            </div>
            <GameLeaderboardPanel gameId="pinball" />
          </div>

          <div className="text-center mt-8">
            <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors text-sm">
              <ArrowLeft className="w-4 h-4" />
              Back to Lobby
            </Link>
          </div>
        </motion.div>
      </main>
    </div>
  );
};

export default NeonPinballPage;
