import { useRef, useEffect, useState, useCallback } from "react";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import GameOverLeaderboard from "@/components/GameOverLeaderboard";

// --- Types ---
type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";
type GameState = "idle" | "playing" | "paused" | "gameover";
type ControlScheme = "arrows" | "qwerty" | "azerty";
interface Point { x: number; y: number; }

const CELL = 20;
const COLS = 20;
const ROWS = 20;
const WIDTH = COLS * CELL;
const HEIGHT = ROWS * CELL;
const BASE_INTERVAL = 140;
const SPEED_INCREMENT = 8;
const SPEED_EVERY = 5;

const OPPOSITE: Record<Direction, Direction> = {
  UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT",
};

const CONTROL_MAPS: Record<ControlScheme, Record<string, Direction>> = {
  arrows: {
    ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT",
  },
  qwerty: {
    w: "UP", W: "UP", s: "DOWN", S: "DOWN", a: "LEFT", A: "LEFT", d: "RIGHT", D: "RIGHT",
  },
  azerty: {
    z: "UP", Z: "UP", s: "DOWN", S: "DOWN", q: "LEFT", Q: "LEFT", d: "RIGHT", D: "RIGHT",
  },
};

const CONTROL_LABELS: Record<ControlScheme, string> = {
  arrows: "Arrows",
  qwerty: "WASD",
  azerty: "ZQSD",
};

const SCHEME_HINT: Record<ControlScheme, string> = {
  arrows: "Arrow keys to move",
  qwerty: "WASD keys to move",
  azerty: "ZQSD keys to move",
};

function randomFood(snake: Point[]): Point {
  let p: Point;
  do {
    p = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
  } while (snake.some((s) => s.x === p.x && s.y === p.y));
  return p;
}

const NeonSnakeGame = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameLoopRef = useRef<number>(0);
  const lastTickRef = useRef(0);

  const [controlScheme, setControlScheme] = useState<ControlScheme>(() => {
    const stored = localStorage.getItem("arcade-control-scheme");
    return (stored as ControlScheme) || "arrows";
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const controlSchemeRef = useRef(controlScheme);

  const [gameState, setGameState] = useState<GameState>("idle");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => {
    const stored = localStorage.getItem("neon-snake-best");
    return stored ? parseInt(stored, 10) : 0;
  });
  const [newRecord, setNewRecord] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // Game state refs for the loop
  const snakeRef = useRef<Point[]>([{ x: 10, y: 10 }]);
  const dirRef = useRef<Direction>("RIGHT");
  const nextDirRef = useRef<Direction>("RIGHT");
  const foodRef = useRef<Point>({ x: 15, y: 10 });
  const scoreRef = useRef(0);
  const stateRef = useRef<GameState>("idle");
  const foodPulseRef = useRef(0);

  useEffect(() => {
    setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  // Sync refs
  useEffect(() => { stateRef.current = gameState; }, [gameState]);
  useEffect(() => { controlSchemeRef.current = controlScheme; }, [controlScheme]);

  const handleSchemeChange = useCallback((scheme: ControlScheme) => {
    setControlScheme(scheme);
    localStorage.setItem("arcade-control-scheme", scheme);
    setSettingsOpen(false);
    toast(`Controls set to ${CONTROL_LABELS[scheme]}`, {
      duration: 2000,
      className: "font-pixel",
    });
  }, []);

  const resetGame = useCallback(() => {
    snakeRef.current = [{ x: 10, y: 10 }];
    dirRef.current = "RIGHT";
    nextDirRef.current = "RIGHT";
    foodRef.current = randomFood([{ x: 10, y: 10 }]);
    scoreRef.current = 0;
    setScore(0);
    setNewRecord(false);
    foodPulseRef.current = 0;
  }, []);

  const startGame = useCallback(() => {
    resetGame();
    setGameState("playing");
    lastTickRef.current = 0;
  }, [resetGame]);

  const togglePause = useCallback(() => {
    setGameState((s) => (s === "playing" ? "paused" : s === "paused" ? "playing" : s));
  }, []);

  const changeDirection = useCallback((d: Direction) => {
    if (stateRef.current !== "playing") return;
    if (d === OPPOSITE[dirRef.current]) return;
    nextDirRef.current = d;
  }, []);

  // Keyboard — dynamically reads controlSchemeRef
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const map = CONTROL_MAPS[controlSchemeRef.current];
      if (map[e.key]) {
        e.preventDefault();
        changeDirection(map[e.key]);
      }
      if (e.key === " " || e.key === "Escape") {
        e.preventDefault();
        if (stateRef.current === "playing" || stateRef.current === "paused") togglePause();
      }
      if (e.key === "Enter" && (stateRef.current === "idle" || stateRef.current === "gameover")) {
        startGame();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [changeDirection, togglePause, startGame]);

  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const tick = () => {
      const snake = snakeRef.current;
      dirRef.current = nextDirRef.current;
      const head = { ...snake[0] };

      switch (dirRef.current) {
        case "UP": head.y--; break;
        case "DOWN": head.y++; break;
        case "LEFT": head.x--; break;
        case "RIGHT": head.x++; break;
      }

      if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
        endGame(); return;
      }
      if (snake.some((s) => s.x === head.x && s.y === head.y)) {
        endGame(); return;
      }

      snake.unshift(head);

      if (head.x === foodRef.current.x && head.y === foodRef.current.y) {
        scoreRef.current += 10;
        setScore(scoreRef.current);
        foodRef.current = randomFood(snake);
      } else {
        snake.pop();
      }
    };

    const endGame = () => {
      setGameState("gameover");
      const s = scoreRef.current;
      if (s > best) {
        setBest(s);
        localStorage.setItem("neon-snake-best", String(s));
        setNewRecord(true);
      }
    };

    const getInterval = () => {
      const eaten = scoreRef.current / 10;
      const speedUps = Math.floor(eaten / SPEED_EVERY);
      return Math.max(50, BASE_INTERVAL - speedUps * SPEED_INCREMENT);
    };

    const draw = (timestamp: number) => {
      gameLoopRef.current = requestAnimationFrame(draw);
      foodPulseRef.current = timestamp;

      if (stateRef.current === "playing") {
        if (timestamp - lastTickRef.current >= getInterval()) {
          lastTickRef.current = timestamp;
          tick();
        }
      }

      ctx.fillStyle = "hsl(230, 25%, 7%)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      ctx.strokeStyle = "hsla(230, 20%, 18%, 0.5)";
      ctx.lineWidth = 0.5;
      for (let x = 0; x <= WIDTH; x += CELL) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, HEIGHT); ctx.stroke();
      }
      for (let y = 0; y <= HEIGHT; y += CELL) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WIDTH, y); ctx.stroke();
      }

      const pulse = 0.6 + 0.4 * Math.sin(timestamp * 0.005);
      const fx = foodRef.current.x * CELL;
      const fy = foodRef.current.y * CELL;
      ctx.save();
      ctx.shadowColor = "hsl(330, 100%, 60%)";
      ctx.shadowBlur = 15 * pulse;
      ctx.fillStyle = `hsla(330, 100%, 60%, ${0.7 + 0.3 * pulse})`;
      ctx.fillRect(fx + 2, fy + 2, CELL - 4, CELL - 4);
      ctx.restore();

      const snake = snakeRef.current;
      snake.forEach((seg, i) => {
        const t = 1 - i / snake.length;
        const sx = seg.x * CELL;
        const sy = seg.y * CELL;
        ctx.save();
        ctx.shadowColor = "hsl(190, 100%, 50%)";
        ctx.shadowBlur = 10 + 8 * t;
        const alpha = 0.4 + 0.6 * t;
        const lightness = 40 + 20 * t;
        ctx.fillStyle = `hsla(190, 100%, ${lightness}%, ${alpha})`;
        const pad = i === 0 ? 1 : 2;
        ctx.fillRect(sx + pad, sy + pad, CELL - pad * 2, CELL - pad * 2);
        ctx.restore();
      });

      ctx.save();
      ctx.shadowColor = "hsl(190, 100%, 50%)";
      ctx.shadowBlur = 8;
      ctx.strokeStyle = "hsla(190, 100%, 50%, 0.3)";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, WIDTH - 2, HEIGHT - 2);
      ctx.restore();
    };

    gameLoopRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(gameLoopRef.current);
  }, [best]);

  const dpad = (dir: Direction) => (e: React.TouchEvent) => {
    e.preventDefault();
    changeDirection(dir);
  };

  const schemes: ControlScheme[] = ["arrows", "qwerty", "azerty"];

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-[440px] mx-auto px-4">
      {/* Score Bar + Settings */}
      <div className="flex items-center justify-between w-full max-w-[400px]">
        <div className="glass rounded-lg px-4 py-2">
          <span className="text-[10px] text-muted-foreground block">SCORE</span>
          <span className="font-pixel text-sm text-primary neon-text-cyan">{score}</span>
        </div>

        {/* Control Scheme Selector */}
        <div className="relative">
          <button
            onClick={() => setSettingsOpen((o) => !o)}
            className="glass rounded-lg p-2.5 text-muted-foreground hover:text-primary transition-colors"
            aria-label="Control settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          {settingsOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSettingsOpen(false)} />
              <div className="absolute top-full right-0 mt-2 z-50 glass rounded-lg p-1.5 neon-glow-cyan min-w-[140px]">
                {schemes.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSchemeChange(s)}
                    className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors ${
                      controlScheme === s
                        ? "bg-primary/20 text-primary neon-text-cyan font-semibold"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`}
                  >
                    <span className="font-pixel text-[9px]">{CONTROL_LABELS[s]}</span>
                    <span className="block text-[10px] mt-0.5 opacity-60">
                      {s === "arrows" ? "↑ ↓ ← →" : s === "qwerty" ? "W A S D" : "Z Q S D"}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="glass rounded-lg px-4 py-2 text-right">
          <span className="text-[10px] text-muted-foreground block">BEST</span>
          <span className="font-pixel text-sm text-neon-yellow">{best}</span>
        </div>
      </div>

      {/* Canvas container */}
      <div className="relative" style={{ width: WIDTH, height: HEIGHT }}>
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="rounded-lg block"
          style={{ imageRendering: "pixelated" }}
        />

        {/* Overlays */}
        {gameState === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center glass rounded-lg">
            <h2 className="font-pixel text-sm text-primary neon-text-cyan mb-4">NEON SNAKE</h2>
            <p className="text-muted-foreground text-sm mb-6 text-center px-4">
              {SCHEME_HINT[controlScheme]}
            </p>
            <button
              onClick={startGame}
              className="bg-secondary text-secondary-foreground font-pixel text-[10px] px-6 py-3 rounded-lg neon-glow-pink hover:scale-105 active:scale-95 transition-transform"
            >
              INSERT COIN
            </button>
          </div>
        )}

        {gameState === "paused" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center glass rounded-lg">
            <h2 className="font-pixel text-sm text-neon-yellow mb-4">PAUSED</h2>
            <button
              onClick={togglePause}
              className="bg-primary text-primary-foreground font-pixel text-[10px] px-6 py-3 rounded-lg neon-glow-cyan hover:scale-105 active:scale-95 transition-transform"
            >
              RESUME
            </button>
          </div>
        )}

        {gameState === "gameover" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center glass rounded-lg">
            <h2 className="font-pixel text-sm text-secondary neon-text-pink mb-2">GAME OVER</h2>
            {newRecord && (
              <p className="font-pixel text-[10px] text-neon-yellow animate-pulse-neon mb-2">
                🏆 NEW RECORD!
              </p>
            )}
            <p className="font-pixel text-xs text-primary neon-text-cyan mb-6">{score} PTS</p>
            <button
              onClick={startGame}
              className="bg-secondary text-secondary-foreground font-pixel text-[10px] px-6 py-3 rounded-lg neon-glow-pink hover:scale-105 active:scale-95 transition-transform"
            >
              INSERT COIN TO REPLAY
            </button>
          </div>
        )}
      </div>

      {/* Pause button */}
      {gameState === "playing" && (
        <button
          onClick={togglePause}
          className="glass rounded-lg px-4 py-2 font-pixel text-[10px] text-muted-foreground hover:text-primary transition-colors"
        >
          PAUSE (ESC)
        </button>
      )}

      {/* Mobile D-Pad */}
      {isTouchDevice && gameState === "playing" && (
        <div className="grid grid-cols-3 gap-1 w-36 mt-2 select-none" style={{ touchAction: "none" }}>
          <div />
          <button onTouchStart={dpad("UP")} className="glass rounded-lg p-4 text-primary active:neon-glow-cyan flex items-center justify-center">
            <span className="font-pixel text-xs">▲</span>
          </button>
          <div />
          <button onTouchStart={dpad("LEFT")} className="glass rounded-lg p-4 text-primary active:neon-glow-cyan flex items-center justify-center">
            <span className="font-pixel text-xs">◀</span>
          </button>
          <div className="glass rounded-lg p-4 opacity-30" />
          <button onTouchStart={dpad("RIGHT")} className="glass rounded-lg p-4 text-primary active:neon-glow-cyan flex items-center justify-center">
            <span className="font-pixel text-xs">▶</span>
          </button>
          <div />
          <button onTouchStart={dpad("DOWN")} className="glass rounded-lg p-4 text-primary active:neon-glow-cyan flex items-center justify-center">
            <span className="font-pixel text-xs">▼</span>
          </button>
          <div />
        </div>
      )}
    </div>
  );
};

export default NeonSnakeGame;
