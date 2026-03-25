import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  gameId: string;
  score: number;
  onScoreSubmitted?: () => void;
}

interface LeaderEntry {
  player_name: string;
  score: number;
}

const GameOverLeaderboard = ({ gameId, score, onScoreSubmitted }: Props) => {
  const { user, username } = useAuth();
  const [top10, setTop10] = useState<LeaderEntry[]>([]);
  const [guestName, setGuestName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchTop10 = async () => {
    const { data } = await supabase
      .from("leaderboards")
      .select("player_name, score")
      .eq("game_id", gameId)
      .order("score", { ascending: false })
      .limit(10);
    setTop10(data ?? []);
  };

  useEffect(() => {
    fetchTop10();
    // Auto-submit for logged-in users
    if (user && username && score > 0) {
      autoSubmitScore();
    }
  }, []);

  const autoSubmitScore = async () => {
    if (!user || !username) return;
    // Check if user already has a score for this game
    const { data: existing } = await supabase
      .from("leaderboards")
      .select("id, score")
      .eq("game_id", gameId)
      .eq("user_id", user.id)
      .order("score", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing && existing.score >= score) {
      setSubmitted(true);
      return;
    }

    if (existing) {
      // Update existing record
      await supabase
        .from("leaderboards")
        .update({ score, player_name: username })
        .eq("id", existing.id);
    } else {
      await supabase
        .from("leaderboards")
        .insert({ game_id: gameId, score, player_name: username, user_id: user.id });
    }
    setSubmitted(true);
    fetchTop10();
    onScoreSubmitted?.();
  };

  const submitGuestScore = async () => {
    const name = guestName.trim();
    if (!name || name.length < 1) return;
    setSubmitting(true);
    await supabase
      .from("leaderboards")
      .insert({ game_id: gameId, score, player_name: name, user_id: null });
    setSubmitted(true);
    setSubmitting(false);
    fetchTop10();
    onScoreSubmitted?.();
  };

  return (
    <div className="mt-3 w-full max-w-[280px] mx-auto">
      {/* Score submission for guests */}
      {!user && !submitted && score > 0 && (
        <div className="flex gap-1 mb-2">
          <input
            type="text"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="Nickname"
            maxLength={16}
            className="flex-1 bg-muted/50 border border-border rounded-md px-2 py-1 text-[10px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={submitGuestScore}
            disabled={submitting || !guestName.trim()}
            className="bg-primary text-primary-foreground font-pixel text-[8px] px-2 py-1 rounded-md hover:scale-105 active:scale-95 transition-transform disabled:opacity-50"
          >
            SAVE
          </button>
        </div>
      )}

      {submitted && (
        <p className="font-pixel text-[8px] text-neon-yellow text-center mb-2">SCORE SAVED!</p>
      )}

      {/* Toggle leaderboard */}
      <button
        onClick={() => setShowBoard(b => !b)}
        className="w-full flex items-center justify-center gap-1 glass rounded-md px-2 py-1.5 text-[10px] text-muted-foreground hover:text-primary transition-colors font-pixel"
      >
        <Trophy className="w-3 h-3" />
        {showBoard ? "HIDE TOP 10" : "VIEW TOP 10"}
      </button>

      {showBoard && (
        <div className="mt-2 glass rounded-lg p-2 space-y-1 max-h-[200px] overflow-y-auto">
          {top10.length === 0 ? (
            <p className="text-[9px] text-muted-foreground text-center font-pixel">NO SCORES YET</p>
          ) : (
            top10.map((entry, i) => (
              <div key={i} className="flex items-center justify-between px-1">
                <span className={`font-pixel text-[8px] ${i < 3 ? "text-neon-yellow" : "text-muted-foreground"}`}>
                  #{i + 1}
                </span>
                <span className="text-[10px] text-foreground flex-1 ml-2 truncate">{entry.player_name}</span>
                <span className="font-pixel text-[8px] text-primary">{entry.score.toLocaleString()}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default GameOverLeaderboard;
