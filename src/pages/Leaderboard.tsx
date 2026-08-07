import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import { supabase } from "@/integrations/supabase/client";

const GAME_LABELS: Record<string, string> = {
  snake: "Neon Snake",
  invaders: "Void Invaders",
  pacman: "Phantom Maze",
};

const GAME_IDS = ["snake", "invaders", "pacman"];

interface LeaderEntry {
  player_name: string;
  score: number;
  game_id: string;
}

const Leaderboard = () => {
  const [leaders, setLeaders] = useState<LeaderEntry[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaders();
  }, [filter]);

  const fetchLeaders = async () => {
    setLoading(true);
    let query = supabase
      .from("leaderboards")
      .select("player_name, score, game_id")
      .order("score", { ascending: false })
      .limit(20);

    if (filter !== "all") {
      query = query.eq("game_id", filter);
    }

    const { data } = await query;
    setLeaders(data ?? []);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-24 pb-16 container mx-auto px-4 max-w-2xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-3 mb-6">
            <Trophy className="w-6 h-6 text-neon-yellow" />
            <h1 className="font-pixel text-lg text-primary neon-text-cyan">Leaderboard</h1>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2 mb-6 flex-wrap">
            <button
              onClick={() => setFilter("all")}
              className={`font-pixel text-[9px] px-3 py-1.5 rounded-md transition-colors ${
                filter === "all" ? "bg-primary/20 text-primary neon-text-cyan" : "glass text-muted-foreground hover:text-foreground"
              }`}
            >
              ALL
            </button>
            {GAME_IDS.map(id => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={`font-pixel text-[9px] px-3 py-1.5 rounded-md transition-colors ${
                  filter === id ? "bg-primary/20 text-primary neon-text-cyan" : "glass text-muted-foreground hover:text-foreground"
                }`}
              >
                {GAME_LABELS[id]?.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {loading ? (
              <p className="text-center text-muted-foreground font-pixel text-[10px]">LOADING...</p>
            ) : leaders.length === 0 ? (
              <p className="text-center text-muted-foreground font-pixel text-[10px]">NO SCORES YET</p>
            ) : (
              leaders.map((leader, i) => (
                <motion.div
                  key={`${leader.player_name}-${leader.score}-${i}`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="glass rounded-lg p-4 flex items-center justify-between neon-glow-cyan"
                >
                  <div className="flex items-center gap-4">
                    <span className={`font-pixel text-xs ${i < 3 ? "text-neon-yellow" : "text-muted-foreground"}`}>
                      #{i + 1}
                    </span>
                    <div>
                      <p className="font-semibold text-foreground">{leader.player_name}</p>
                      <p className="text-xs text-muted-foreground">{GAME_LABELS[leader.game_id] ?? leader.game_id}</p>
                    </div>
                  </div>
                  <span className="font-pixel text-xs text-primary neon-text-cyan">
                    {leader.score.toLocaleString()}
                  </span>
                </motion.div>
              ))
            )}
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
