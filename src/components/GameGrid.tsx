import GameCard from "./GameCard";
import gameSnake from "@/assets/game-snake.jpg";
import gameInvaders from "@/assets/game-invaders.jpg";
import gamePacman from "@/assets/game-pacman.jpg";
import gameRacer from "@/assets/game-racer.jpg";
import gamePinball from "@/assets/game-pinball.jpg";

const games = [
  {
    title: "Neon Snake",
    description: "The timeless classic revisited in 60fps. Slither through neon grids and dominate the leaderboard.",
    image: gameSnake,
    highScore: 48750,
    slug: "neon-snake",
  },
  {
    title: "Void Invaders",
    description: "Defend the galaxy from pixelated alien hordes. Fast-paced action with synthwave vibes.",
    image: gameInvaders,
    highScore: 125300,
    slug: "void-invaders",
  },
  {
    title: "Phantom Maze",
    description: "Navigate neon labyrinths, eat power pellets, and outrun ghosts in this arcade legend.",
    image: gamePacman,
    highScore: 89200,
    slug: "phantom-maze",
  },
  {
    title: "Super Kart Racer",
    description: "SNES Mode-7 style arcade circuit. 3 laps, tight drifts and a mini boost on release.",
    image: gameRacer,
    highScore: 0,
    slug: "super-kart",
  },
  {
    title: "Neon Pinball",
    description: "Retro-futuristic pinball with rock-solid physics and snappy flippers. Phase 1: pure feel.",
    image: gamePinball,
    highScore: 0,
    slug: "neon-pinball",
  },
];

const GameGrid = () => {
  return (
    <section className="py-20">
      <div className="container mx-auto px-4">
        <h2 className="font-pixel text-sm sm:text-base text-primary neon-text-cyan text-center mb-12">
          Choose Your Game
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {games.map((game, index) => (
            <GameCard key={game.slug} {...game} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default GameGrid;
