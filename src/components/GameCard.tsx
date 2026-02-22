import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Star } from "lucide-react";

interface GameCardProps {
  title: string;
  description: string;
  image: string;
  highScore: number;
  slug: string;
  index: number;
}

const GameCard = ({ title, description, image, highScore, slug, index }: GameCardProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
    >
      <Link
        to={`/game/${slug}`}
        className="block group glass rounded-xl overflow-hidden neon-glow-cyan hover:neon-glow-pink transition-all duration-500 hover:scale-[1.02]"
      >
        {/* Thumbnail */}
        <div className="relative aspect-video overflow-hidden">
          <img
            src={image}
            alt={title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-card to-transparent" />

          {/* High Score Badge */}
          <div className="absolute top-3 right-3 flex items-center gap-1.5 glass rounded-full px-3 py-1">
            <Star className="w-3 h-3 text-neon-yellow fill-neon-yellow" />
            <span className="font-pixel text-[10px] text-neon-yellow">
              {highScore.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Info */}
        <div className="p-4">
          <h3 className="font-pixel text-xs text-primary neon-text-cyan mb-2 group-hover:text-secondary group-hover:neon-text-pink transition-all duration-300">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {description}
          </p>
        </div>
      </Link>
    </motion.div>
  );
};

export default GameCard;
