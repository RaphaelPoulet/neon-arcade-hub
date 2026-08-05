import { useCallback, useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  gameId: string;
  title?: string;
}

interface Entry {
  player_name: string;
  score: number;
}

const GameLeaderboardPanel = ({ gameId, title = "HIGH SCORES" }: Props) => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchScores = useCallback(async () => {
    const { data } = await supabase
      .from("leaderboards")
      .select("player_name, score")
      .eq("game_id", gameId)
      .order("score", { ascending: false })
      .limit(10);
    setEntries(data ?? []);
    setLoading(false);
  }, [gameId]);

  useEffect(() => {
    fetchScores();
    const channel = supabase
      .channel(`scores-${gameId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leaderboards", filter: `game_id=eq.${gameId}` },
        () => fetchScores()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [gameId, fetchScores]);

  return (
    <aside className="glass rounded-xl border border-border/50 neon-glow-cyan p-4 w-full lg:w-[260px] shrink-0 self-start">
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="w-4 h-4 text-neon-yellow" />
        <h2 className="font-pixel text-[9px] text-primary neon-text-cyan">{title}</h2>
      </div>

      {loading ? (
        <p className="font-pixel text-[8px] text-muted-foreground text-center">LOADING...</p>
      ) : entries.length === 0 ? (
        <p className="font-pixel text-[8px] text-muted-foreground text-center">NO SCORES YET</p>
      ) : (
        <ol className="space-y-2">
          {entries.map((e, i) => (
            <li key={`${e.player_name}-${i}`} className="flex items-center gap-2">
              <span className={`font-pixel text-[8px] w-6 ${i < 3 ? "text-neon-yellow" : "text-muted-foreground"}`}>
                #{i + 1}
              </span>
              <span className="text-[11px] text-foreground flex-1 truncate">{e.player_name}</span>
              <span className="font-pixel text-[8px] text-secondary">{e.score.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
};

export default GameLeaderboardPanel;
