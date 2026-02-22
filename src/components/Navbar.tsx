import { Link } from "react-router-dom";
import { Trophy, User, Gamepad2 } from "lucide-react";

const Navbar = () => {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass border-b neon-border-cyan">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          <Gamepad2 className="w-6 h-6 text-primary neon-text-cyan group-hover:animate-pulse-neon transition-all" />
          <span className="font-pixel text-xs sm:text-sm text-primary neon-text-cyan">
            RetroArcade
          </span>
        </Link>

        <div className="flex items-center gap-4 sm:gap-6">
          <Link
            to="/leaderboard"
            className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors text-sm"
          >
            <Trophy className="w-4 h-4" />
            <span className="hidden sm:inline">Leaderboard</span>
          </Link>

          <button className="flex items-center gap-2 glass rounded-full px-3 py-1.5 hover:neon-glow-cyan transition-all">
            <User className="w-4 h-4 text-primary" />
            <span className="hidden sm:inline text-sm text-foreground">Player1</span>
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
