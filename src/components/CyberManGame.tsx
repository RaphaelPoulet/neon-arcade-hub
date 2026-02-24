import { useRef, useEffect, useState, useCallback } from "react";
import { Settings } from "lucide-react";
import { toast } from "sonner";

// --- Types ---
type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";
type GameState = "idle" | "ready" | "playing" | "dying" | "levelcomplete" | "gameover";
type GhostMode = "scatter" | "chase" | "frightened" | "eaten";
type ControlScheme = "arrows" | "qwerty" | "azerty";

interface Point { x: number; y: number; }
interface Ghost {
  x: number; y: number;
  dir: Direction;
  mode: GhostMode;
  color: string;
  scatterTarget: Point;
  homeTarget: Point;
  speed: number;
  frightenedTimer: number;
}

// --- Constants ---
const TILE = 16;
const COLS = 28;
const ROWS = 31;
const WIDTH = COLS * TILE;
const HEIGHT = ROWS * TILE;
const PLAYER_SPEED = 1.8;
const GHOST_SPEED = 1.6;
const GHOST_FRIGHTENED_SPEED = 0.8;
const GHOST_EATEN_SPEED = 3.0;
const FRIGHTENED_DURATION = 6000;
const SCATTER_DURATION = 7000;
const CHASE_DURATION = 20000;

// Maze: 0=empty, 1=wall, 2=pellet, 3=power pellet, 4=ghost house, 5=ghost door, 6=tunnel
const MAZE_TEMPLATE: number[][] = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,2,2,2,2,2,2,2,2,2,2,2,2,1,1,2,2,2,2,2,2,2,2,2,2,2,2,1],
  [1,2,1,1,1,1,2,1,1,1,1,1,2,1,1,2,1,1,1,1,1,2,1,1,1,1,2,1],
  [1,3,1,1,1,1,2,1,1,1,1,1,2,1,1,2,1,1,1,1,1,2,1,1,1,1,3,1],
  [1,2,1,1,1,1,2,1,1,1,1,1,2,1,1,2,1,1,1,1,1,2,1,1,1,1,2,1],
  [1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1],
  [1,2,1,1,1,1,2,1,1,2,1,1,1,1,1,1,1,1,2,1,1,2,1,1,1,1,2,1],
  [1,2,1,1,1,1,2,1,1,2,1,1,1,1,1,1,1,1,2,1,1,2,1,1,1,1,2,1],
  [1,2,2,2,2,2,2,1,1,2,2,2,2,1,1,2,2,2,2,1,1,2,2,2,2,2,2,1],
  [1,1,1,1,1,1,2,1,1,1,1,1,0,1,1,0,1,1,1,1,1,2,1,1,1,1,1,1],
  [0,0,0,0,0,1,2,1,1,1,1,1,0,1,1,0,1,1,1,1,1,2,1,0,0,0,0,0],
  [0,0,0,0,0,1,2,1,1,0,0,0,0,0,0,0,0,0,0,1,1,2,1,0,0,0,0,0],
  [0,0,0,0,0,1,2,1,1,0,1,1,1,5,5,1,1,1,0,1,1,2,1,0,0,0,0,0],
  [1,1,1,1,1,1,2,1,1,0,1,4,4,4,4,4,4,1,0,1,1,2,1,1,1,1,1,1],
  [6,0,0,0,0,0,2,0,0,0,1,4,4,4,4,4,4,1,0,0,0,2,0,0,0,0,0,6],
  [1,1,1,1,1,1,2,1,1,0,1,4,4,4,4,4,4,1,0,1,1,2,1,1,1,1,1,1],
  [0,0,0,0,0,1,2,1,1,0,1,1,1,1,1,1,1,1,0,1,1,2,1,0,0,0,0,0],
  [0,0,0,0,0,1,2,1,1,0,0,0,0,0,0,0,0,0,0,1,1,2,1,0,0,0,0,0],
  [0,0,0,0,0,1,2,1,1,0,1,1,1,1,1,1,1,1,0,1,1,2,1,0,0,0,0,0],
  [1,1,1,1,1,1,2,1,1,0,1,1,1,1,1,1,1,1,0,1,1,2,1,1,1,1,1,1],
  [1,2,2,2,2,2,2,2,2,2,2,2,2,1,1,2,2,2,2,2,2,2,2,2,2,2,2,1],
  [1,2,1,1,1,1,2,1,1,1,1,1,2,1,1,2,1,1,1,1,1,2,1,1,1,1,2,1],
  [1,2,1,1,1,1,2,1,1,1,1,1,2,1,1,2,1,1,1,1,1,2,1,1,1,1,2,1],
  [1,3,2,2,1,1,2,2,2,2,2,2,2,0,0,2,2,2,2,2,2,2,1,1,2,2,3,1],
  [1,1,1,2,1,1,2,1,1,2,1,1,1,1,1,1,1,1,2,1,1,2,1,1,2,1,1,1],
  [1,1,1,2,1,1,2,1,1,2,1,1,1,1,1,1,1,1,2,1,1,2,1,1,2,1,1,1],
  [1,2,2,2,2,2,2,1,1,2,2,2,2,1,1,2,2,2,2,1,1,2,2,2,2,2,2,1],
  [1,2,1,1,1,1,1,1,1,1,1,1,2,1,1,2,1,1,1,1,1,1,1,1,1,1,2,1],
  [1,2,1,1,1,1,1,1,1,1,1,1,2,1,1,2,1,1,1,1,1,1,1,1,1,1,2,1],
  [1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

const CONTROL_MAPS: Record<ControlScheme, Record<string, Direction>> = {
  arrows: { ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT" },
  qwerty: { w: "UP", W: "UP", s: "DOWN", S: "DOWN", a: "LEFT", A: "LEFT", d: "RIGHT", D: "RIGHT" },
  azerty: { z: "UP", Z: "UP", s: "DOWN", S: "DOWN", q: "LEFT", Q: "LEFT", d: "RIGHT", D: "RIGHT" },
};

const CONTROL_LABELS: Record<ControlScheme, string> = { arrows: "Arrows", qwerty: "WASD", azerty: "ZQSD" };
const SCHEME_HINT: Record<ControlScheme, string> = { arrows: "Arrow keys to move", qwerty: "WASD keys to move", azerty: "ZQSD keys to move" };

// --- Helpers ---
function isWalkable(maze: number[][], col: number, row: number): boolean {
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) {
    // Allow tunnel rows
    if (row === 14 && (col < 0 || col >= COLS)) return true;
    return false;
  }
  const t = maze[row][col];
  return t !== 1;
}

function canMove(maze: number[][], x: number, y: number, dir: Direction): boolean {
  let nx = x, ny = y;
  switch (dir) {
    case "UP": ny--; break;
    case "DOWN": ny++; break;
    case "LEFT": nx--; break;
    case "RIGHT": nx++; break;
  }
  return isWalkable(maze, nx, ny);
}

function dist(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function getOpposite(d: Direction): Direction {
  const map: Record<Direction, Direction> = { UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT" };
  return map[d];
}

function chooseDirection(maze: number[][], gx: number, gy: number, target: Point, currentDir: Direction): Direction {
  const dirs: Direction[] = ["UP", "LEFT", "DOWN", "RIGHT"];
  const opposite = getOpposite(currentDir);
  let bestDir = currentDir;
  let bestDist = Infinity;
  for (const d of dirs) {
    if (d === opposite) continue;
    let nx = gx, ny = gy;
    switch (d) {
      case "UP": ny--; break;
      case "DOWN": ny++; break;
      case "LEFT": nx--; break;
      case "RIGHT": nx++; break;
    }
    if (!isWalkable(maze, nx, ny) || maze[ny]?.[nx] === 5 && d === "DOWN") continue;
    // Ghost can't enter door going down unless eaten
    const dd = dist({ x: nx, y: ny }, target);
    if (dd < bestDist) {
      bestDist = dd;
      bestDir = d;
    }
  }
  return bestDir;
}

function chooseRandomDirection(maze: number[][], gx: number, gy: number, currentDir: Direction): Direction {
  const dirs: Direction[] = ["UP", "LEFT", "DOWN", "RIGHT"];
  const opposite = getOpposite(currentDir);
  const valid = dirs.filter(d => {
    if (d === opposite) return false;
    let nx = gx, ny = gy;
    switch (d) {
      case "UP": ny--; break;
      case "DOWN": ny++; break;
      case "LEFT": nx--; break;
      case "RIGHT": nx++; break;
    }
    return isWalkable(maze, nx, ny);
  });
  return valid.length > 0 ? valid[Math.floor(Math.random() * valid.length)] : opposite;
}

// --- Component ---
const CyberManGame = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loopRef = useRef(0);

  const [controlScheme, setControlScheme] = useState<ControlScheme>(() => {
    const stored = localStorage.getItem("arcade-control-scheme");
    return (stored as ControlScheme) || "arrows";
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const controlSchemeRef = useRef(controlScheme);

  const [gameState, setGameState] = useState<GameState>("idle");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => {
    const s = localStorage.getItem("cyber-man-best");
    return s ? parseInt(s, 10) : 0;
  });
  const [lives, setLives] = useState(3);
  const [level, setLevel] = useState(1);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // Refs
  const stateRef = useRef<GameState>("idle");
  const mazeRef = useRef<number[][]>([]);
  const playerRef = useRef({ x: 14, y: 23, dir: "LEFT" as Direction, nextDir: "LEFT" as Direction, mouthAngle: 0 });
  const ghostsRef = useRef<Ghost[]>([]);
  const scoreRef = useRef(0);
  const livesRef = useRef(3);
  const levelRef = useRef(1);
  const bestRef = useRef(best);
  const pelletsLeftRef = useRef(0);
  const modeTimerRef = useRef(0);
  const globalModeRef = useRef<"scatter" | "chase">("scatter");
  const readyTimerRef = useRef(0);
  const dyingTimerRef = useRef(0);
  const levelCompleteTimerRef = useRef(0);
  const ghostEatenComboRef = useRef(0);

  useEffect(() => { setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0); }, []);
  useEffect(() => { stateRef.current = gameState; }, [gameState]);
  useEffect(() => { controlSchemeRef.current = controlScheme; }, [controlScheme]);

  const handleSchemeChange = useCallback((scheme: ControlScheme) => {
    setControlScheme(scheme);
    localStorage.setItem("arcade-control-scheme", scheme);
    setSettingsOpen(false);
    toast(`Controls set to ${CONTROL_LABELS[scheme]}`, { duration: 2000, className: "font-pixel" });
  }, []);

  const initMaze = useCallback(() => {
    const maze = MAZE_TEMPLATE.map(row => [...row]);
    let pellets = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (maze[r][c] === 2 || maze[r][c] === 3) pellets++;
      }
    }
    mazeRef.current = maze;
    pelletsLeftRef.current = pellets;
  }, []);

  const initGhosts = useCallback((): Ghost[] => {
    return [
      { x: 14, y: 11, dir: "LEFT", mode: "scatter", color: "hsl(0,100%,50%)", scatterTarget: { x: 25, y: 0 }, homeTarget: { x: 14, y: 14 }, speed: GHOST_SPEED, frightenedTimer: 0 },
      { x: 13, y: 14, dir: "UP", mode: "scatter", color: "hsl(330,100%,70%)", scatterTarget: { x: 2, y: 0 }, homeTarget: { x: 13, y: 14 }, speed: GHOST_SPEED, frightenedTimer: 0 },
      { x: 14, y: 14, dir: "UP", mode: "scatter", color: "hsl(190,100%,50%)", scatterTarget: { x: 25, y: 30 }, homeTarget: { x: 14, y: 14 }, speed: GHOST_SPEED, frightenedTimer: 0 },
      { x: 15, y: 14, dir: "UP", mode: "scatter", color: "hsl(30,100%,50%)", scatterTarget: { x: 2, y: 30 }, homeTarget: { x: 15, y: 14 }, speed: GHOST_SPEED, frightenedTimer: 0 },
    ];
  }, []);

  const startGame = useCallback(() => {
    initMaze();
    const ghosts = initGhosts();
    ghostsRef.current = ghosts;
    playerRef.current = { x: 14, y: 23, dir: "LEFT", nextDir: "LEFT", mouthAngle: 0 };
    scoreRef.current = 0;
    livesRef.current = 3;
    levelRef.current = 1;
    ghostEatenComboRef.current = 0;
    setScore(0);
    setLives(3);
    setLevel(1);
    globalModeRef.current = "scatter";
    modeTimerRef.current = 0;
    readyTimerRef.current = 2000;
    setGameState("ready");
  }, [initMaze, initGhosts]);

  const resetPositions = useCallback(() => {
    playerRef.current = { x: 14, y: 23, dir: "LEFT", nextDir: "LEFT", mouthAngle: 0 };
    ghostsRef.current = initGhosts();
    globalModeRef.current = "scatter";
    modeTimerRef.current = 0;
    ghostEatenComboRef.current = 0;
    readyTimerRef.current = 2000;
    setGameState("ready");
  }, [initGhosts]);

  const nextLevel = useCallback(() => {
    levelRef.current++;
    setLevel(levelRef.current);
    initMaze();
    playerRef.current = { x: 14, y: 23, dir: "LEFT", nextDir: "LEFT", mouthAngle: 0 };
    ghostsRef.current = initGhosts();
    globalModeRef.current = "scatter";
    modeTimerRef.current = 0;
    ghostEatenComboRef.current = 0;
    readyTimerRef.current = 2000;
    setGameState("ready");
  }, [initMaze, initGhosts]);

  // Input
  const bufferDirection = useCallback((d: Direction) => {
    if (stateRef.current === "playing") {
      playerRef.current.nextDir = d;
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const map = CONTROL_MAPS[controlSchemeRef.current];
      if (map[e.key]) { e.preventDefault(); bufferDirection(map[e.key]); }
      if (e.key === "Enter" && (stateRef.current === "idle" || stateRef.current === "gameover")) startGame();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [bufferDirection, startGame]);

  // Game Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let lastTime = 0;

    const loop = (timestamp: number) => {
      loopRef.current = requestAnimationFrame(loop);
      const dt = lastTime ? Math.min(timestamp - lastTime, 50) : 16;
      lastTime = timestamp;

      const state = stateRef.current;
      const maze = mazeRef.current;
      const player = playerRef.current;
      const ghosts = ghostsRef.current;

      // --- Update ---
      if (state === "ready") {
        readyTimerRef.current -= dt;
        if (readyTimerRef.current <= 0) setGameState("playing");
      }

      if (state === "dying") {
        dyingTimerRef.current -= dt;
        if (dyingTimerRef.current <= 0) {
          if (livesRef.current <= 0) {
            if (scoreRef.current > bestRef.current) {
              bestRef.current = scoreRef.current;
              setBest(scoreRef.current);
              localStorage.setItem("cyber-man-best", String(scoreRef.current));
            }
            setGameState("gameover");
          } else {
            resetPositions();
          }
        }
      }

      if (state === "levelcomplete") {
        levelCompleteTimerRef.current -= dt;
        if (levelCompleteTimerRef.current <= 0) nextLevel();
      }

      if (state === "playing") {
        // Mode timer
        modeTimerRef.current += dt;
        const cycleDuration = SCATTER_DURATION + CHASE_DURATION;
        const cyclePos = modeTimerRef.current % cycleDuration;
        globalModeRef.current = cyclePos < SCATTER_DURATION ? "scatter" : "chase";

        // Move player
        const speed = PLAYER_SPEED;
        const px = Math.round(player.x);
        const py = Math.round(player.y);
        const atCenter = Math.abs(player.x - px) < 0.08 && Math.abs(player.y - py) < 0.08;

        if (atCenter) {
          player.x = px;
          player.y = py;
          // Try buffered direction first
          if (canMove(maze, px, py, player.nextDir)) {
            player.dir = player.nextDir;
          }
          // Move in current direction if possible
          if (canMove(maze, px, py, player.dir)) {
            switch (player.dir) {
              case "UP": player.y -= speed * dt / 1000 * 10; break;
              case "DOWN": player.y += speed * dt / 1000 * 10; break;
              case "LEFT": player.x -= speed * dt / 1000 * 10; break;
              case "RIGHT": player.x += speed * dt / 1000 * 10; break;
            }
          }
        } else {
          // Continue moving
          switch (player.dir) {
            case "UP": player.y -= speed * dt / 1000 * 10; break;
            case "DOWN": player.y += speed * dt / 1000 * 10; break;
            case "LEFT": player.x -= speed * dt / 1000 * 10; break;
            case "RIGHT": player.x += speed * dt / 1000 * 10; break;
          }
          // Snap when close
          const npx = Math.round(player.x);
          const npy = Math.round(player.y);
          if (Math.abs(player.x - npx) < 0.08 && Math.abs(player.y - npy) < 0.08) {
            player.x = npx;
            player.y = npy;
          }
        }

        // Warp tunnels
        if (player.x < -1) player.x = COLS;
        if (player.x > COLS) player.x = -1;

        // Eat pellets
        const cx = Math.round(player.x);
        const cy = Math.round(player.y);
        if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) {
          const tile = maze[cy][cx];
          if (tile === 2) {
            maze[cy][cx] = 0;
            scoreRef.current += 10;
            setScore(scoreRef.current);
            pelletsLeftRef.current--;
          } else if (tile === 3) {
            maze[cy][cx] = 0;
            scoreRef.current += 50;
            setScore(scoreRef.current);
            pelletsLeftRef.current--;
            ghostEatenComboRef.current = 0;
            for (const g of ghosts) {
              if (g.mode !== "eaten") {
                g.mode = "frightened";
                g.frightenedTimer = FRIGHTENED_DURATION;
                g.dir = getOpposite(g.dir);
              }
            }
          }
          if (pelletsLeftRef.current <= 0) {
            levelCompleteTimerRef.current = 2000;
            setGameState("levelcomplete");
          }
        }

        // Move ghosts
        for (const g of ghosts) {
          if (g.mode === "frightened") {
            g.frightenedTimer -= dt;
            if (g.frightenedTimer <= 0) g.mode = globalModeRef.current;
          }

          const gSpeed = g.mode === "frightened" ? GHOST_FRIGHTENED_SPEED
            : g.mode === "eaten" ? GHOST_EATEN_SPEED : GHOST_SPEED;

          const gx = Math.round(g.x);
          const gy = Math.round(g.y);
          const gAtCenter = Math.abs(g.x - gx) < 0.08 && Math.abs(g.y - gy) < 0.08;

          if (gAtCenter) {
            g.x = gx;
            g.y = gy;

            // Choose target
            let target: Point;
            if (g.mode === "scatter") target = g.scatterTarget;
            else if (g.mode === "chase") target = { x: Math.round(player.x), y: Math.round(player.y) };
            else if (g.mode === "eaten") {
              target = g.homeTarget;
              if (gx === g.homeTarget.x && gy === g.homeTarget.y) {
                g.mode = globalModeRef.current;
              }
            } else {
              // frightened - random
              g.dir = chooseRandomDirection(maze, gx, gy, g.dir);
              target = { x: 0, y: 0 }; // unused
            }

            if (g.mode !== "frightened") {
              g.dir = chooseDirection(maze, gx, gy, target, g.dir);
            }
          }

          // Move
          switch (g.dir) {
            case "UP": g.y -= gSpeed * dt / 1000 * 10; break;
            case "DOWN": g.y += gSpeed * dt / 1000 * 10; break;
            case "LEFT": g.x -= gSpeed * dt / 1000 * 10; break;
            case "RIGHT": g.x += gSpeed * dt / 1000 * 10; break;
          }

          // Snap
          const ngx = Math.round(g.x);
          const ngy = Math.round(g.y);
          if (Math.abs(g.x - ngx) < 0.08 && Math.abs(g.y - ngy) < 0.08) {
            g.x = ngx;
            g.y = ngy;
          }

          // Warp tunnels
          if (g.x < -1) g.x = COLS;
          if (g.x > COLS) g.x = -1;

          // Collision with player
          const pdist = dist({ x: player.x, y: player.y }, { x: g.x, y: g.y });
          if (pdist < 0.8) {
            if (g.mode === "frightened") {
              g.mode = "eaten";
              ghostEatenComboRef.current++;
              const bonus = 200 * Math.pow(2, ghostEatenComboRef.current - 1);
              scoreRef.current += bonus;
              setScore(scoreRef.current);
            } else if (g.mode !== "eaten") {
              livesRef.current--;
              setLives(livesRef.current);
              dyingTimerRef.current = 1500;
              setGameState("dying");
            }
          }
        }

        // Mouth animation
        player.mouthAngle = 0.3 + 0.2 * Math.sin(timestamp * 0.015);
      }

      // --- Draw ---
      ctx.fillStyle = "hsl(230, 25%, 7%)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      if (maze.length === 0) {
        // Draw idle screen handled by overlay
        loopRef.current = requestAnimationFrame(loop);
        return;
      }

      // Draw maze
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const tile = maze[r][c];
          const x = c * TILE;
          const y = r * TILE;

          if (tile === 1) {
            // Wall
            ctx.save();
            ctx.strokeStyle = "hsla(190, 100%, 50%, 0.5)";
            ctx.lineWidth = 1;
            // Draw wall edges
            const top = r > 0 && maze[r - 1][c] !== 1;
            const bottom = r < ROWS - 1 && maze[r + 1][c] !== 1;
            const left = c > 0 && maze[r][c - 1] !== 1;
            const right = c < COLS - 1 && maze[r][c + 1] !== 1;

            ctx.shadowColor = "hsl(190, 100%, 50%)";
            ctx.shadowBlur = 4;
            if (top) { ctx.beginPath(); ctx.moveTo(x, y + 0.5); ctx.lineTo(x + TILE, y + 0.5); ctx.stroke(); }
            if (bottom) { ctx.beginPath(); ctx.moveTo(x, y + TILE - 0.5); ctx.lineTo(x + TILE, y + TILE - 0.5); ctx.stroke(); }
            if (left) { ctx.beginPath(); ctx.moveTo(x + 0.5, y); ctx.lineTo(x + 0.5, y + TILE); ctx.stroke(); }
            if (right) { ctx.beginPath(); ctx.moveTo(x + TILE - 0.5, y); ctx.lineTo(x + TILE - 0.5, y + TILE); ctx.stroke(); }
            ctx.restore();
          } else if (tile === 5) {
            // Ghost door
            ctx.save();
            ctx.strokeStyle = "hsla(330, 100%, 60%, 0.6)";
            ctx.lineWidth = 2;
            ctx.shadowColor = "hsl(330, 100%, 60%)";
            ctx.shadowBlur = 4;
            ctx.beginPath();
            ctx.moveTo(x, y + TILE / 2);
            ctx.lineTo(x + TILE, y + TILE / 2);
            ctx.stroke();
            ctx.restore();
          } else if (tile === 2) {
            // Pellet
            ctx.save();
            ctx.fillStyle = "hsla(60, 100%, 90%, 0.9)";
            ctx.shadowColor = "hsl(60, 100%, 90%)";
            ctx.shadowBlur = 3;
            ctx.beginPath();
            ctx.arc(x + TILE / 2, y + TILE / 2, 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          } else if (tile === 3) {
            // Power pellet
            const pulse = 0.5 + 0.5 * Math.sin(timestamp * 0.005);
            ctx.save();
            ctx.fillStyle = `hsla(60, 100%, 90%, ${0.6 + 0.4 * pulse})`;
            ctx.shadowColor = "hsl(60, 100%, 90%)";
            ctx.shadowBlur = 8 * pulse;
            ctx.beginPath();
            ctx.arc(x + TILE / 2, y + TILE / 2, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }

      // Draw player
      if (state !== "dying" || dyingTimerRef.current > 500) {
        const px_ = player.x * TILE + TILE / 2;
        const py_ = player.y * TILE + TILE / 2;
        const mouth = player.mouthAngle || 0.3;
        let angle = 0;
        switch (player.dir) {
          case "RIGHT": angle = 0; break;
          case "DOWN": angle = Math.PI / 2; break;
          case "LEFT": angle = Math.PI; break;
          case "UP": angle = -Math.PI / 2; break;
        }

        ctx.save();
        ctx.fillStyle = "hsl(50, 100%, 55%)";
        ctx.shadowColor = "hsl(50, 100%, 55%)";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(px_, py_, TILE / 2 - 1, angle + mouth, angle + Math.PI * 2 - mouth);
        ctx.lineTo(px_, py_);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        // Dying animation - shrinking pac-man
        const progress = 1 - dyingTimerRef.current / 500;
        const px_ = player.x * TILE + TILE / 2;
        const py_ = player.y * TILE + TILE / 2;
        ctx.save();
        ctx.fillStyle = "hsl(50, 100%, 55%)";
        ctx.shadowColor = "hsl(50, 100%, 55%)";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(px_, py_, (TILE / 2 - 1) * (1 - progress), progress * Math.PI, Math.PI * 2 + progress * Math.PI);
        ctx.lineTo(px_, py_);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Draw ghosts
      for (const g of ghosts) {
        const gx_ = g.x * TILE + TILE / 2;
        const gy_ = g.y * TILE + TILE / 2;
        const r = TILE / 2 - 1;

        ctx.save();
        if (g.mode === "frightened") {
          const flashing = g.frightenedTimer < 2000 && Math.floor(timestamp / 200) % 2 === 0;
          ctx.fillStyle = flashing ? "hsl(0, 0%, 90%)" : "hsl(220, 80%, 60%)";
          ctx.shadowColor = flashing ? "hsl(0, 0%, 90%)" : "hsl(220, 80%, 60%)";
        } else if (g.mode === "eaten") {
          ctx.fillStyle = "hsla(0, 0%, 100%, 0.3)";
          ctx.shadowColor = "transparent";
        } else {
          ctx.fillStyle = g.color;
          ctx.shadowColor = g.color;
        }
        ctx.shadowBlur = 8;

        // Ghost body
        ctx.beginPath();
        ctx.arc(gx_, gy_ - 2, r, Math.PI, 0);
        ctx.lineTo(gx_ + r, gy_ + r);
        // Wavy bottom
        const wave = Math.sin(timestamp * 0.01) * 2;
        for (let i = 0; i < 3; i++) {
          const wx = gx_ + r - (i + 1) * (r * 2 / 3);
          ctx.quadraticCurveTo(wx + r / 3, gy_ + r + wave * (i % 2 === 0 ? 1 : -1), wx, gy_ + r);
        }
        ctx.closePath();
        ctx.fill();

        // Eyes
        if (g.mode !== "frightened") {
          const eyeOffX = g.dir === "LEFT" ? -2 : g.dir === "RIGHT" ? 2 : 0;
          const eyeOffY = g.dir === "UP" ? -2 : g.dir === "DOWN" ? 2 : 0;
          ctx.fillStyle = "white";
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.arc(gx_ - 3, gy_ - 3, 3, 0, Math.PI * 2);
          ctx.arc(gx_ + 3, gy_ - 3, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "hsl(220, 80%, 20%)";
          ctx.beginPath();
          ctx.arc(gx_ - 3 + eyeOffX, gy_ - 3 + eyeOffY, 1.5, 0, Math.PI * 2);
          ctx.arc(gx_ + 3 + eyeOffX, gy_ - 3 + eyeOffY, 1.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Frightened face
          ctx.strokeStyle = "white";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(gx_ - 3, gy_ - 3, 1.5, 0, Math.PI * 2);
          ctx.arc(gx_ + 3, gy_ - 3, 1.5, 0, Math.PI * 2);
          ctx.stroke();
          // Squiggly mouth
          ctx.beginPath();
          ctx.moveTo(gx_ - 4, gy_ + 2);
          for (let i = 0; i < 4; i++) {
            ctx.lineTo(gx_ - 4 + i * 2 + 1, gy_ + (i % 2 === 0 ? 0 : 4));
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      // Lives display
      for (let i = 0; i < livesRef.current; i++) {
        ctx.save();
        ctx.fillStyle = "hsl(50, 100%, 55%)";
        ctx.beginPath();
        ctx.arc(20 + i * 20, HEIGHT - 10, 6, 0.3, Math.PI * 2 - 0.3);
        ctx.lineTo(20 + i * 20, HEIGHT - 10);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Level display
      ctx.save();
      ctx.fillStyle = "hsla(190, 100%, 50%, 0.6)";
      ctx.font = "9px 'Press Start 2P'";
      ctx.textAlign = "right";
      ctx.fillText(`LV ${levelRef.current}`, WIDTH - 10, HEIGHT - 6);
      ctx.restore();
    };

    loopRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(loopRef.current);
  }, [resetPositions, nextLevel]);

  const dpad = (dir: Direction) => (e: React.TouchEvent) => {
    e.preventDefault();
    bufferDirection(dir);
  };

  const schemes: ControlScheme[] = ["arrows", "qwerty", "azerty"];

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-[480px] mx-auto px-4">
      {/* Score Bar */}
      <div className="flex items-center justify-between w-full max-w-[448px]">
        <div className="glass rounded-lg px-4 py-2">
          <span className="text-[10px] text-muted-foreground block">SCORE</span>
          <span className="font-pixel text-sm text-primary neon-text-cyan">{score}</span>
        </div>

        <div className="relative">
          <button onClick={() => setSettingsOpen(o => !o)} className="glass rounded-lg p-2.5 text-muted-foreground hover:text-primary transition-colors" aria-label="Control settings">
            <Settings className="w-4 h-4" />
          </button>
          {settingsOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSettingsOpen(false)} />
              <div className="absolute top-full right-0 mt-2 z-50 glass rounded-lg p-1.5 neon-glow-cyan min-w-[140px]">
                {schemes.map(s => (
                  <button key={s} onClick={() => handleSchemeChange(s)} className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors ${controlScheme === s ? "bg-primary/20 text-primary neon-text-cyan font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}>
                    <span className="font-pixel text-[9px]">{CONTROL_LABELS[s]}</span>
                    <span className="block text-[10px] mt-0.5 opacity-60">{s === "arrows" ? "↑ ↓ ← →" : s === "qwerty" ? "W A S D" : "Z Q S D"}</span>
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

      {/* Canvas */}
      <div className="relative" style={{ width: WIDTH, height: HEIGHT }}>
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="rounded-lg block" style={{ imageRendering: "pixelated" }} />

        {gameState === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center glass rounded-lg">
            <h2 className="font-pixel text-sm text-neon-yellow neon-text-cyan mb-4">CYBER-MAN</h2>
            <p className="text-muted-foreground text-sm mb-6 text-center px-4">{SCHEME_HINT[controlScheme]}</p>
            <button onClick={startGame} className="bg-secondary text-secondary-foreground font-pixel text-[10px] px-6 py-3 rounded-lg neon-glow-pink hover:scale-105 active:scale-95 transition-transform">
              INSERT COIN
            </button>
          </div>
        )}

        {gameState === "ready" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <h2 className="font-pixel text-lg text-neon-yellow animate-pulse">READY!</h2>
          </div>
        )}

        {gameState === "levelcomplete" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <h2 className="font-pixel text-sm text-primary neon-text-cyan animate-pulse">LEVEL COMPLETE!</h2>
          </div>
        )}

        {gameState === "gameover" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center glass rounded-lg">
            <h2 className="font-pixel text-sm text-secondary neon-text-pink mb-2">GAME OVER</h2>
            {scoreRef.current >= bestRef.current && scoreRef.current > 0 && (
              <p className="font-pixel text-[10px] text-neon-yellow animate-pulse-neon mb-2">🏆 NEW RECORD!</p>
            )}
            <p className="font-pixel text-xs text-primary neon-text-cyan mb-6">{score} PTS</p>
            <button onClick={startGame} className="bg-secondary text-secondary-foreground font-pixel text-[10px] px-6 py-3 rounded-lg neon-glow-pink hover:scale-105 active:scale-95 transition-transform">
              INSERT COIN TO REPLAY
            </button>
          </div>
        )}
      </div>

      {/* Mobile D-Pad */}
      {isTouchDevice && (gameState === "playing" || gameState === "ready") && (
        <div className="grid grid-cols-3 gap-1 w-36 mt-2 select-none" style={{ touchAction: "none" }}>
          <div />
          <button onTouchStart={dpad("UP")} className="glass rounded-lg p-4 text-primary active:neon-glow-cyan flex items-center justify-center"><span className="font-pixel text-xs">▲</span></button>
          <div />
          <button onTouchStart={dpad("LEFT")} className="glass rounded-lg p-4 text-primary active:neon-glow-cyan flex items-center justify-center"><span className="font-pixel text-xs">◀</span></button>
          <div className="glass rounded-lg p-4 opacity-30" />
          <button onTouchStart={dpad("RIGHT")} className="glass rounded-lg p-4 text-primary active:neon-glow-cyan flex items-center justify-center"><span className="font-pixel text-xs">▶</span></button>
          <div />
          <button onTouchStart={dpad("DOWN")} className="glass rounded-lg p-4 text-primary active:neon-glow-cyan flex items-center justify-center"><span className="font-pixel text-xs">▼</span></button>
          <div />
        </div>
      )}
    </div>
  );
};

export default CyberManGame;
