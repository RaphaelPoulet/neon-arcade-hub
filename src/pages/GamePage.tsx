import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Clock } from "lucide-react";
import Navbar from "@/components/Navbar";

const GamePage = () => {
  const { slug } = useParams();

  const title = slug
    ?.split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16 flex items-center justify-center min-h-screen">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center px-4"
        >
          <div className="inline-flex items-center gap-2 glass rounded-full px-4 py-2 mb-8 neon-glow-pink animate-pulse-neon">
            <Clock className="w-4 h-4 text-secondary" />
            <span className="font-pixel text-[10px] text-secondary">Coming Soon</span>
          </div>

          <h1 className="font-pixel text-xl sm:text-2xl md:text-3xl text-primary neon-text-cyan mb-4">
            {title}
          </h1>

          <p className="text-muted-foreground mb-8 max-w-md mx-auto">
            This game is currently in development. Check back soon for the full arcade experience.
          </p>

          <Link
            to="/"
            className="inline-flex items-center gap-2 text-primary hover:text-secondary transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Lobby
          </Link>
        </motion.div>
      </main>
    </div>
  );
};

export default GamePage;
