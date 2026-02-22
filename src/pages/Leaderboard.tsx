import { motion } from "framer-motion";
import { ArrowLeft, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";

const mockLeaders = [
  { rank: 1, name: "NeonKnight", score: 125300, game: "Void Invaders" },
  { rank: 2, name: "PixelQueen", score: 89200, game: "Phantom Maze" },
  { rank: 3, name: "ByteRunner", score: 67400, game: "Neon Racer" },
  { rank: 4, name: "GlitchMaster", score: 48750, game: "Neon Snake" },
  { rank: 5, name: "CyberFox", score: 42100, game: "Void Invaders" },
];

const Leaderboard = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-24 pb-16 container mx-auto px-4 max-w-2xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-3 mb-8">
            <Trophy className="w-6 h-6 text-neon-yellow" />
            <h1 className="font-pixel text-lg text-primary neon-text-cyan">Leaderboard</h1>
          </div>

          <div className="space-y-3">
            {mockLeaders.map((leader, i) => (
              <motion.div
                key={leader.rank}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                className="glass rounded-lg p-4 flex items-center justify-between neon-glow-cyan"
              >
                <div className="flex items-center gap-4">
                  <span className={`font-pixel text-xs ${leader.rank <= 3 ? "text-neon-yellow" : "text-muted-foreground"}`}>
                    #{leader.rank}
                  </span>
                  <div>
                    <p className="font-semibold text-foreground">{leader.name}</p>
                    <p className="text-xs text-muted-foreground">{leader.game}</p>
                  </div>
                </div>
                <span className="font-pixel text-xs text-primary neon-text-cyan">
                  {leader.score.toLocaleString()}
                </span>
              </motion.div>
            ))}
          </div>

          <Link
            to="/"
            className="inline-flex items-center gap-2 text-primary hover:text-secondary transition-colors mt-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Lobby
          </Link>
        </motion.div>
      </main>
    </div>
  );
};

export default Leaderboard;
