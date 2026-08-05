import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import Navbar from "@/components/Navbar";
import CyberManGame from "@/components/CyberManGame";
import GameLeaderboardPanel from "@/components/GameLeaderboardPanel";

const CyberManPage = () => {
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
            <h1 className="font-pixel text-lg sm:text-xl text-neon-yellow neon-text-cyan mb-2">
              Phantom Maze
            </h1>
            <p className="text-sm text-muted-foreground">
              Navigate the neon maze. Consume all pellets. Survive.
            </p>
          </div>

          <div className="flex flex-col lg:flex-row gap-6 items-start justify-center">
            <div className="flex-1 min-w-0 w-full">
              <CyberManGame />
            </div>
            <GameLeaderboardPanel gameId="pacman" />
          </div>

          <div className="text-center mt-8">
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Lobby
            </Link>
          </div>
        </motion.div>
      </main>
    </div>
  );
};

export default CyberManPage;
