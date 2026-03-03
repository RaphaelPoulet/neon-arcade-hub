import { useRef, useEffect, useState, useCallback } from "react";
import { Settings } from "lucide-react";
import { toast } from "sonner";

// --- Types ---
type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";
type GameState = "idle" | "ready" | "playing" | "dying" | "levelcomplete" | "gameover";
type GhostMode = "scatter" | "chase" | "frightened" | "eaten" | "leaving";
type ControlScheme = "arrows" | "qwerty" | "azerty";
type GhostName = "blinky" | "pinky" | "inky" | "clyde";

interface Ghost {
  x: number; y: number;
  dir: Direction;
  mode: GhostMode;
  color: string;
  scatterTarget: { x: number; y: number };
  home: { x: number; y: number };
  frightenedTimer: number;
  name: GhostName;
  exitDelay: number; // ms before leaving house
  pelletThreshold: number; // pellets eaten before ghost can leave
  stuckFrames: number; // frames with zero movement (stuck detection)
  lastX: number; lastY: number; // for stuck detection
}

interface Fruit {
  x: number; y: number;
  timer: number; // ms remaining
  points: number;
  symbol: string;
  active: boolean;
}

interface ScorePopup {
  x: number; y: number; // pixel coords
  text: string;
  timer: number; // ms remaining
  maxTimer: number;
}

// --- Constants ---
const TILE = 16;
const COLS = 28;
const ROWS = 31;
const W = COLS * TILE;
const H = ROWS * TILE;
const PAC_SPEED = 0.005;
const GHOST_SPEED = 0.0045;
const GHOST_FRIGHT_SPEED = 0.0025;
const GHOST_EATEN_SPEED = 0.009;
const GHOST_LEAVING_SPEED = 0.003;
const FRIGHT_DUR = 6000;
const SCATTER_DUR = 7000;
const CHASE_DUR = 20000;
const FRUIT_DURATION = 10000;
const GHOST_HOUSE_EXIT = { x: 14, y: 11 }; // tile above door

const OPPOSITE: Record<Direction, Direction> = { UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT" };
const DX: Record<Direction, number> = { UP: 0, DOWN: 0, LEFT: -1, RIGHT: 1 };
const DY: Record<Direction, number> = { UP: -1, DOWN: 1, LEFT: 0, RIGHT: 0 };

// Fruit types by level
const FRUIT_TABLE: { symbol: string; points: number }[] = [
  { symbol: "🍒", points: 100 },
  { symbol: "🍓", points: 300 },
  { symbol: "🍊", points: 500 },
  { symbol: "🍎", points: 700 },
  { symbol: "🍇", points: 1000 },
];

// 0=empty 1=wall 2=pellet 3=power 4=house 5=door 6=tunnel
const MAZE_TPL: number[][] = [
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

const CTRL: Record<ControlScheme, Record<string, Direction>> = {
  arrows: { ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT" },
  qwerty: { w: "UP", W: "UP", s: "DOWN", S: "DOWN", a: "LEFT", A: "LEFT", d: "RIGHT", D: "RIGHT" },
  azerty: { z: "UP", Z: "UP", s: "DOWN", S: "DOWN", q: "LEFT", Q: "LEFT", d: "RIGHT", D: "RIGHT" },
};
const CTRL_LABEL: Record<ControlScheme, string> = { arrows: "Arrows", qwerty: "WASD", azerty: "ZQSD" };
const CTRL_HINT: Record<ControlScheme, string> = { arrows: "Arrow keys to move", qwerty: "WASD keys to move", azerty: "ZQSD keys to move" };

// --- Helpers ---
function walkable(maze: number[][], c: number, r: number): boolean {
  if (r === 14 && (c < 0 || c >= COLS)) return true;
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
  return maze[r][c] !== 1;
}

function walkableGhost(maze: number[][], c: number, r: number, allowDoor: boolean): boolean {
  if (r === 14 && (c < 0 || c >= COLS)) return true;
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
  const t = maze[r][c];
  if (t === 1) return false;
  if (t === 5 && !allowDoor) return false;
  return true;
}

function canGo(maze: number[][], c: number, r: number, d: Direction): boolean {
  return walkable(maze, c + DX[d], r + DY[d]);
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

function pickDir(maze: number[][], gx: number, gy: number, tx: number, ty: number, cur: Direction, allowDoor: boolean): Direction {
  const dirs: Direction[] = ["UP", "LEFT", "DOWN", "RIGHT"];
  const opp = OPPOSITE[cur];
  let best = cur;
  let bestD = Infinity;
  for (const d of dirs) {
    if (d === opp) continue;
    const nx = gx + DX[d], ny = gy + DY[d];
    if (!walkableGhost(maze, nx, ny, allowDoor)) continue;
    const dd = dist2(nx, ny, tx, ty);
    if (dd < bestD) { bestD = dd; best = d; }
  }
  return best;
}

function randomDir(maze: number[][], gx: number, gy: number, cur: Direction): Direction {
  const dirs: Direction[] = ["UP", "LEFT", "DOWN", "RIGHT"];
  const opp = OPPOSITE[cur];
  const valid = dirs.filter(d => d !== opp && walkable(maze, gx + DX[d], gy + DY[d]));
  return valid.length > 0 ? valid[Math.floor(Math.random() * valid.length)] : opp;
}

// Flee direction: pick the tile that maximizes distance from pac-man
function fleeDir(maze: number[][], gx: number, gy: number, px: number, py: number, cur: Direction): Direction {
  const dirs: Direction[] = ["UP", "LEFT", "DOWN", "RIGHT"];
  const opp = OPPOSITE[cur];
  let best = cur;
  let bestD = -1;
  for (const d of dirs) {
    if (d === opp) continue;
    const nx = gx + DX[d], ny = gy + DY[d];
    if (!walkable(maze, nx, ny)) continue;
    const dd = dist2(nx, ny, px, py);
    if (dd > bestD) { bestD = dd; best = d; }
  }
  // fallback if nothing found
  if (bestD < 0) return randomDir(maze, gx, gy, cur);
  return best;
}

// Ghost AI targeting per personality
function getGhostTarget(
  ghost: Ghost,
  pac: { x: number; y: number; dir: Direction },
  blinky: Ghost
): { x: number; y: number } {
  switch (ghost.name) {
    case "blinky":
      // Direct chase: target Pac-Man's current tile
      return { x: Math.round(pac.x), y: Math.round(pac.y) };

    case "pinky": {
      // Ambush: target 4 tiles ahead of Pac-Man
      const px = Math.round(pac.x) + DX[pac.dir] * 4;
      const py = Math.round(pac.y) + DY[pac.dir] * 4;
      return { x: px, y: py };
    }

    case "inky": {
      // Flanker: vector from Blinky to 2 tiles ahead of Pac-Man, doubled
      const ahead2x = Math.round(pac.x) + DX[pac.dir] * 2;
      const ahead2y = Math.round(pac.y) + DY[pac.dir] * 2;
      const vecX = ahead2x - Math.round(blinky.x);
      const vecY = ahead2y - Math.round(blinky.y);
      return { x: ahead2x + vecX, y: ahead2y + vecY };
    }

    case "clyde": {
      // Shy: chase if far, scatter if close (8 tile radius)
      const d = dist2(ghost.x, ghost.y, pac.x, pac.y);
      if (d > 64) { // 8^2
        return { x: Math.round(pac.x), y: Math.round(pac.y) };
      }
      return ghost.scatterTarget; // bottom-left corner
    }
  }
}

// --- Build static wall canvas ---
function buildWallCanvas(maze: number[][]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;

  // Pass 1: Solid dark fill for all wall tiles
  for (let r = 0; r < ROWS; r++) {
    for (let col = 0; col < COLS; col++) {
      if (maze[r][col] !== 1) continue;
      ctx.fillStyle = "hsl(230, 40%, 8%)";
      ctx.fillRect(col * TILE, r * TILE, TILE, TILE);
    }
  }

  // Pass 2: Neon edge strokes on borders adjacent to walkable tiles
  ctx.save();
  for (let r = 0; r < ROWS; r++) {
    for (let col = 0; col < COLS; col++) {
      if (maze[r][col] !== 1) continue;
      const x = col * TILE, y = r * TILE;

      const top = r > 0 && maze[r - 1][col] !== 1;
      const bot = r < ROWS - 1 && maze[r + 1][col] !== 1;
      const lft = col > 0 && maze[r][col - 1] !== 1;
      const rgt = col < COLS - 1 && maze[r][col + 1] !== 1;

      if (top || bot || lft || rgt) {
        ctx.strokeStyle = "hsla(190, 100%, 55%, 0.7)";
        ctx.lineWidth = 1.5;
        ctx.shadowColor = "hsl(190, 100%, 50%)";
        ctx.shadowBlur = 6;

        if (top) { ctx.beginPath(); ctx.moveTo(x, y + 0.5); ctx.lineTo(x + TILE, y + 0.5); ctx.stroke(); }
        if (bot) { ctx.beginPath(); ctx.moveTo(x, y + TILE - 0.5); ctx.lineTo(x + TILE, y + TILE - 0.5); ctx.stroke(); }
        if (lft) { ctx.beginPath(); ctx.moveTo(x + 0.5, y); ctx.lineTo(x + 0.5, y + TILE); ctx.stroke(); }
        if (rgt) { ctx.beginPath(); ctx.moveTo(x + TILE - 0.5, y); ctx.lineTo(x + TILE - 0.5, y + TILE); ctx.stroke(); }
      }
    }
  }
  ctx.restore();

  // Ghost door
  ctx.save();
  for (let r = 0; r < ROWS; r++) {
    for (let col = 0; col < COLS; col++) {
      if (maze[r][col] !== 5) continue;
      const x = col * TILE, y = r * TILE;
      ctx.strokeStyle = "hsla(330, 100%, 60%, 0.6)";
      ctx.lineWidth = 2;
      ctx.shadowColor = "hsl(330, 100%, 60%)";
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.moveTo(x, y + TILE / 2);
      ctx.lineTo(x + TILE, y + TILE / 2);
      ctx.stroke();
    }
  }
  ctx.restore();

  return c;
}

// --- Component ---
const CyberManGame = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loopRef = useRef(0);
  const wallCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [controlScheme, setControlScheme] = useState<ControlScheme>(() => {
    return (localStorage.getItem("arcade-control-scheme") as ControlScheme) || "arrows";
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const csRef = useRef(controlScheme);

  const [gameState, setGameState] = useState<GameState>("idle");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => {
    const s = localStorage.getItem("phantom-maze-best");
    return s ? parseInt(s, 10) : 0;
  });
  const [lives, setLives] = useState(3);
  const [level, setLevel] = useState(1);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // Game refs
  const sRef = useRef<GameState>("idle");
  const mazeRef = useRef<number[][]>([]);
  const pRef = useRef({ x: 14, y: 23, dir: "LEFT" as Direction, nextDir: "LEFT" as Direction, moveT: 0 });
  const ghostsRef = useRef<Ghost[]>([]);
  const scoreRef = useRef(0);
  const livesRef = useRef(3);
  const levelRef = useRef(1);
  const bestRef = useRef(best);
  const pelletsRef = useRef(0);
  const totalPelletsRef = useRef(0);
  const pelletsEatenRef = useRef(0);
  const modeTimerRef = useRef(0);
  const globalModeRef = useRef<"scatter" | "chase">("scatter");
  const readyTRef = useRef(0);
  const dyingTRef = useRef(0);
  const lvlCompTRef = useRef(0);
  const comboRef = useRef(0);
  const fruitRef = useRef<Fruit>({ x: 14, y: 17, timer: 0, points: 0, symbol: "", active: false });
  const fruitSpawnedRef = useRef<Set<number>>(new Set());
  const popupsRef = useRef<ScorePopup[]>([]);
  useEffect(() => { setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0); }, []);
  useEffect(() => { sRef.current = gameState; }, [gameState]);
  useEffect(() => { csRef.current = controlScheme; }, [controlScheme]);

  const handleScheme = useCallback((s: ControlScheme) => {
    setControlScheme(s);
    localStorage.setItem("arcade-control-scheme", s);
    setSettingsOpen(false);
    toast(`Controls set to ${CTRL_LABEL[s]}`, { duration: 2000, className: "font-pixel" });
  }, []);

  const makeGhosts = useCallback((): Ghost[] => [
    { x: 14, y: 11, dir: "LEFT", mode: "scatter", color: "hsl(0,100%,50%)", scatterTarget: { x: 25, y: 0 }, home: { x: 14, y: 14 }, frightenedTimer: 0, name: "blinky", exitDelay: 0, pelletThreshold: 0, stuckFrames: 0, lastX: 14, lastY: 11 },
    { x: 13, y: 14, dir: "UP", mode: "leaving", color: "hsl(330,100%,70%)", scatterTarget: { x: 2, y: 0 }, home: { x: 13, y: 14 }, frightenedTimer: 0, name: "pinky", exitDelay: 0, pelletThreshold: 0, stuckFrames: 0, lastX: 13, lastY: 14 },
    { x: 14, y: 14, dir: "UP", mode: "leaving", color: "hsl(190,100%,50%)", scatterTarget: { x: 25, y: 30 }, home: { x: 14, y: 14 }, frightenedTimer: 0, name: "inky", exitDelay: 0, pelletThreshold: 30, stuckFrames: 0, lastX: 14, lastY: 14 },
    { x: 15, y: 14, dir: "UP", mode: "leaving", color: "hsl(30,100%,50%)", scatterTarget: { x: 2, y: 30 }, home: { x: 15, y: 14 }, frightenedTimer: 0, name: "clyde", exitDelay: 0, pelletThreshold: 60, stuckFrames: 0, lastX: 15, lastY: 14 },
  ], []);

  const initMaze = useCallback(() => {
    const maze = MAZE_TPL.map(r => [...r]);
    let p = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (maze[r][c] === 2 || maze[r][c] === 3) p++;
    mazeRef.current = maze;
    pelletsRef.current = p;
    totalPelletsRef.current = p;
    pelletsEatenRef.current = 0;
    wallCanvasRef.current = buildWallCanvas(maze);
  }, []);

  const resetPos = useCallback(() => {
    pRef.current = { x: 14, y: 23, dir: "LEFT", nextDir: "LEFT", moveT: 0 };
    ghostsRef.current = makeGhosts();
    globalModeRef.current = "scatter";
    modeTimerRef.current = 0;
    comboRef.current = 0;
    readyTRef.current = 2000;
    setGameState("ready");
  }, [makeGhosts]);

  const spawnPopup = useCallback((tileX: number, tileY: number, text: string) => {
    popupsRef.current.push({
      x: tileX * TILE + TILE / 2,
      y: tileY * TILE + TILE / 2,
      text,
      timer: 800,
      maxTimer: 800,
    });
  }, []);

  const startGame = useCallback(() => {
    initMaze();
    ghostsRef.current = makeGhosts();
    pRef.current = { x: 14, y: 23, dir: "LEFT", nextDir: "LEFT", moveT: 0 };
    scoreRef.current = 0;
    livesRef.current = 3;
    levelRef.current = 1;
    comboRef.current = 0;
    fruitRef.current = { x: 14, y: 17, timer: 0, points: 0, symbol: "", active: false };
    fruitSpawnedRef.current = new Set();
    popupsRef.current = [];
    setScore(0); setLives(3); setLevel(1);
    globalModeRef.current = "scatter";
    modeTimerRef.current = 0;
    readyTRef.current = 2000;
    setGameState("ready");
  }, [initMaze, makeGhosts]);

  const nextLvl = useCallback(() => {
    levelRef.current++;
    setLevel(levelRef.current);
    initMaze();
    pRef.current = { x: 14, y: 23, dir: "LEFT", nextDir: "LEFT", moveT: 0 };
    ghostsRef.current = makeGhosts();
    globalModeRef.current = "scatter";
    modeTimerRef.current = 0;
    comboRef.current = 0;
    fruitRef.current = { x: 14, y: 17, timer: 0, points: 0, symbol: "", active: false };
    fruitSpawnedRef.current = new Set();
    readyTRef.current = 2000;
    setGameState("ready");
  }, [initMaze, makeGhosts]);

  const bufDir = useCallback((d: Direction) => {
    if (sRef.current === "playing") pRef.current.nextDir = d;
  }, []);

  // Keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const map = CTRL[csRef.current];
      if (map[e.key]) { e.preventDefault(); bufDir(map[e.key]); }
      if (e.key === "Enter" && (sRef.current === "idle" || sRef.current === "gameover")) startGame();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [bufDir, startGame]);

  // Prevent scroll on touch
  useEffect(() => {
    const prevent = (e: TouchEvent) => {
      if (sRef.current === "playing" || sRef.current === "ready") e.preventDefault();
    };
    document.addEventListener("touchmove", prevent, { passive: false });
    return () => document.removeEventListener("touchmove", prevent);
  }, []);

  // === GAME LOOP ===
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let prev = 0;

    const SNAP = 0.02;
    const isAtCenter = (e: { x: number; y: number }) =>
      Math.abs(e.x - Math.round(e.x)) < SNAP && Math.abs(e.y - Math.round(e.y)) < SNAP;
    const snapToCenter = (e: { x: number; y: number }) => { e.x = Math.round(e.x); e.y = Math.round(e.y); };

    const moveEntity = (entity: { x: number; y: number; dir: Direction }, speed: number, dt: number): boolean => {
      const move = speed * dt;
      const dx = DX[entity.dir];
      const dy = DY[entity.dir];

      let destX: number, destY: number;
      if (dx > 0) destX = Math.ceil(entity.x + 0.001);
      else if (dx < 0) destX = Math.floor(entity.x - 0.001);
      else destX = Math.round(entity.x);
      if (dy > 0) destY = Math.ceil(entity.y + 0.001);
      else if (dy < 0) destY = Math.floor(entity.y - 0.001);
      else destY = Math.round(entity.y);

      entity.x += dx * move;
      entity.y += dy * move;

      if (dx > 0 && entity.x >= destX) entity.x = destX;
      if (dx < 0 && entity.x <= destX) entity.x = destX;
      if (dy > 0 && entity.y >= destY) entity.y = destY;
      if (dy < 0 && entity.y <= destY) entity.y = destY;

      if (isAtCenter(entity)) { snapToCenter(entity); return true; }
      return false;
    };

    // Move ghost toward a specific coordinate (for leaving house)
    const moveToward = (g: Ghost, tx: number, ty: number, speed: number, dt: number): boolean => {
        const ddx = tx - g.x;
        const ddy = ty - g.y;
        void ddx; void ddy;
      const move = speed * dt;

      if (Math.abs(ddx) > 0.02) {
        g.x += Math.sign(ddx) * Math.min(move, Math.abs(ddx));
      } else if (Math.abs(ddy) > 0.02) {
        g.y += Math.sign(ddy) * Math.min(move, Math.abs(ddy));
      }

      return Math.abs(g.x - tx) < 0.05 && Math.abs(g.y - ty) < 0.05;
    };

    const frame = (ts: number) => {
      loopRef.current = requestAnimationFrame(frame);
      const dt = prev ? Math.min(ts - prev, 50) : 16;
      prev = ts;

      const state = sRef.current;
      const maze = mazeRef.current;
      const p = pRef.current;
      const ghosts = ghostsRef.current;
      const blinky = ghosts[0]; // Reference for Inky's targeting

      // --- Timers ---
      if (state === "ready") {
        readyTRef.current -= dt;
        if (readyTRef.current <= 0) setGameState("playing");
      }
      if (state === "dying") {
        dyingTRef.current -= dt;
        if (dyingTRef.current <= 0) {
          if (livesRef.current <= 0) {
            if (scoreRef.current > bestRef.current) {
              bestRef.current = scoreRef.current;
              setBest(scoreRef.current);
              localStorage.setItem("phantom-maze-best", String(scoreRef.current));
            }
            setGameState("gameover");
          } else {
            resetPos();
          }
        }
      }
      if (state === "levelcomplete") {
        lvlCompTRef.current -= dt;
        if (lvlCompTRef.current <= 0) nextLvl();
      }

      // --- Playing logic ---
      if (state === "playing") {
        // Global mode cycling
        modeTimerRef.current += dt;
        const cycle = SCATTER_DUR + CHASE_DUR;
        globalModeRef.current = (modeTimerRef.current % cycle) < SCATTER_DUR ? "scatter" : "chase";

        // Player movement
        if (isAtCenter(p)) {
          snapToCenter(p);
          const px = p.x, py = p.y;
          if (canGo(maze, px, py, p.nextDir)) p.dir = p.nextDir;
          if (canGo(maze, px, py, p.dir)) moveEntity(p, PAC_SPEED, dt);
        } else {
          let destTileX: number, destTileY: number;
          if (DX[p.dir] > 0) destTileX = Math.ceil(p.x + 0.001);
          else if (DX[p.dir] < 0) destTileX = Math.floor(p.x - 0.001);
          else destTileX = Math.round(p.x);
          if (DY[p.dir] > 0) destTileY = Math.ceil(p.y + 0.001);
          else if (DY[p.dir] < 0) destTileY = Math.floor(p.y - 0.001);
          else destTileY = Math.round(p.y);

          if (walkable(maze, destTileX, destTileY)) moveEntity(p, PAC_SPEED, dt);
          else snapToCenter(p);
        }

        // Warp
        if (p.x < -1) p.x = COLS;
        if (p.x > COLS) p.x = -1;

        // Eat pellets
        const cx = Math.round(p.x), cy = Math.round(p.y);
        if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) {
          const t = maze[cy][cx];
          if (t === 2) {
            maze[cy][cx] = 0;
            scoreRef.current += 10;
            setScore(scoreRef.current);
            pelletsRef.current--;
            pelletsEatenRef.current++;
          } else if (t === 3) {
            maze[cy][cx] = 0;
            scoreRef.current += 50;
            setScore(scoreRef.current);
            pelletsRef.current--;
            pelletsEatenRef.current++;
            comboRef.current = 0;
            spawnPopup(cx, cy, "+50");
            for (const g of ghosts) {
              if (g.mode !== "eaten" && g.mode !== "leaving") {
                g.mode = "frightened";
                g.frightenedTimer = FRIGHT_DUR;
                g.dir = OPPOSITE[g.dir];
              }
            }
          }

          // Fruit spawning at 70 and 170 pellets eaten
          const eaten = pelletsEatenRef.current;
          for (const threshold of [70, 170]) {
            if (eaten >= threshold && !fruitSpawnedRef.current.has(threshold)) {
              fruitSpawnedRef.current.add(threshold);
              const lvlIdx = Math.min(levelRef.current - 1, FRUIT_TABLE.length - 1);
              const ft = FRUIT_TABLE[lvlIdx];
              fruitRef.current = { x: 14, y: 17, timer: FRUIT_DURATION, points: ft.points, symbol: ft.symbol, active: true };
            }
          }

          if (pelletsRef.current <= 0) {
            lvlCompTRef.current = 2000;
            setGameState("levelcomplete");
          }
        }

        // Fruit timer
        if (fruitRef.current.active) {
          fruitRef.current.timer -= dt;
          if (fruitRef.current.timer <= 0) fruitRef.current.active = false;

          // Check if pac-man eats the fruit
          if (dist2(p.x, p.y, fruitRef.current.x, fruitRef.current.y) < 0.64) {
            const pts = fruitRef.current.points;
            scoreRef.current += pts;
            setScore(scoreRef.current);
            spawnPopup(fruitRef.current.x, fruitRef.current.y, `+${pts}`);
            fruitRef.current.active = false;
          }
        }

        // Ghost logic
        for (const g of ghosts) {
          // Handle "leaving" house state
          if (g.mode === "leaving") {
            // Pellet-based exit: wait until enough pellets eaten
            if (pelletsEatenRef.current < g.pelletThreshold) continue;

            // Move to center-x of house, then up to exit
            const houseCenterX = 14;
            const exitY = GHOST_HOUSE_EXIT.y;

            if (Math.abs(g.x - houseCenterX) > 0.1) {
              moveToward(g, houseCenterX, g.y, GHOST_LEAVING_SPEED, dt);
            } else if (Math.abs(g.y - exitY) > 0.1) {
              g.x = houseCenterX;
              moveToward(g, houseCenterX, exitY, GHOST_LEAVING_SPEED, dt);
            } else {
              g.x = GHOST_HOUSE_EXIT.x;
              g.y = GHOST_HOUSE_EXIT.y;
              g.mode = globalModeRef.current;
              g.dir = "LEFT";
            }
            continue;
          }

          // Eaten ghosts: use moveToward to ignore walls, go straight home
          if (g.mode === "eaten") {
            const arrived = moveToward(g, g.home.x, g.home.y, GHOST_EATEN_SPEED, dt);
            if (arrived) {
              g.x = g.home.x;
              g.y = g.home.y;
              g.mode = "leaving";
              g.pelletThreshold = 0; // can exit immediately after respawn
              g.stuckFrames = 0;
            }
            // Collision check for eaten (no kill)
            continue;
          }

          if (g.mode === "frightened") {
            g.frightenedTimer -= dt;
            if (g.frightenedTimer <= 0) g.mode = globalModeRef.current;
          }

          const spd = g.mode === "frightened" ? GHOST_FRIGHT_SPEED : GHOST_SPEED;

          // Stuck detection: if ghost hasn't moved for 10+ frames, force random direction
          if (Math.abs(g.x - g.lastX) < 0.001 && Math.abs(g.y - g.lastY) < 0.001) {
            g.stuckFrames++;
          } else {
            g.stuckFrames = 0;
          }
          g.lastX = g.x;
          g.lastY = g.y;

          if (g.stuckFrames > 10) {
            // Force break deadlock: pick any available direction
            const dirs: Direction[] = ["UP", "LEFT", "DOWN", "RIGHT"];
            const valid = dirs.filter(d => walkable(maze, Math.round(g.x) + DX[d], Math.round(g.y) + DY[d]));
            if (valid.length > 0) {
              g.dir = valid[Math.floor(Math.random() * valid.length)];
              g.stuckFrames = 0;
            }
          }

          if (isAtCenter(g)) {
            snapToCenter(g);
            const gx = g.x, gy = g.y;

            let tx: number, ty: number;
            if (g.mode === "scatter") {
              tx = g.scatterTarget.x;
              ty = g.scatterTarget.y;
            } else if (g.mode === "chase") {
              const target = getGhostTarget(g, p, blinky);
              tx = target.x;
              ty = target.y;
            } else {
              // Frightened: flee away from Pac-Man
              g.dir = fleeDir(maze, gx, gy, Math.round(p.x), Math.round(p.y), g.dir);
              tx = 0; ty = 0;
            }

            if (g.mode !== "frightened") {
              g.dir = pickDir(maze, gx, gy, tx, ty, g.dir, false);
            }

            // Always try to move - if canGo fails for current dir, try any dir
            if (canGo(maze, gx, gy, g.dir)) {
              moveEntity(g, spd, dt);
            } else {
              // Fallback: pick any walkable direction
              const dirs: Direction[] = ["UP", "LEFT", "DOWN", "RIGHT"];
              for (const d of dirs) {
                if (canGo(maze, gx, gy, d)) {
                  g.dir = d;
                  moveEntity(g, spd, dt);
                  break;
                }
              }
            }
          } else {
            let destTileX: number, destTileY: number;
            if (DX[g.dir] > 0) destTileX = Math.ceil(g.x + 0.001);
            else if (DX[g.dir] < 0) destTileX = Math.floor(g.x - 0.001);
            else destTileX = Math.round(g.x);
            if (DY[g.dir] > 0) destTileY = Math.ceil(g.y + 0.001);
            else if (DY[g.dir] < 0) destTileY = Math.floor(g.y - 0.001);
            else destTileY = Math.round(g.y);

            if (walkable(maze, destTileX, destTileY)) moveEntity(g, spd, dt);
            else snapToCenter(g);
          }

          // Warp
          if (g.x < -1) g.x = COLS;
          if (g.x > COLS) g.x = -1;

          // Collision
          if (dist2(p.x, p.y, g.x, g.y) < 0.64) {
            if (g.mode === "frightened") {
              g.mode = "eaten";
              comboRef.current++;
              const pts = 200 * Math.pow(2, comboRef.current - 1);
              scoreRef.current += pts;
              setScore(scoreRef.current);
              spawnPopup(g.x, g.y, `+${pts}`);
            } else if (g.mode === "scatter" || g.mode === "chase") {
              livesRef.current--;
              setLives(livesRef.current);
              dyingTRef.current = 1500;
              setGameState("dying");
            }
          }
        }

        // Update score popups
        popupsRef.current = popupsRef.current.filter(pop => {
          pop.timer -= dt;
          pop.y -= dt * 0.02; // float upward
          return pop.timer > 0;
        });
      }

      // === DRAW ===
      ctx.fillStyle = "hsl(230, 25%, 7%)";
      ctx.fillRect(0, 0, W, H);

      if (maze.length === 0) return;

      // Walls
      if (wallCanvasRef.current) ctx.drawImage(wallCanvasRef.current, 0, 0);

      // Pellets
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const t = maze[r][c];
          if (t === 2) {
            ctx.fillStyle = "hsla(60, 100%, 90%, 0.9)";
            ctx.shadowColor = "hsl(60, 100%, 90%)";
            ctx.shadowBlur = 3;
            ctx.beginPath();
            ctx.arc(c * TILE + TILE / 2, r * TILE + TILE / 2, 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
          } else if (t === 3) {
            const pulse = 0.5 + 0.5 * Math.sin(ts * 0.005);
            ctx.fillStyle = `hsla(60, 100%, 90%, ${0.6 + 0.4 * pulse})`;
            ctx.shadowColor = "hsl(60, 100%, 90%)";
            ctx.shadowBlur = 8 * pulse;
            ctx.beginPath();
            ctx.arc(c * TILE + TILE / 2, r * TILE + TILE / 2, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        }
      }

      // Bonus Fruit
      if (fruitRef.current.active) {
        const fx = fruitRef.current.x * TILE + TILE / 2;
        const fy = fruitRef.current.y * TILE + TILE / 2;
        const pulse = 0.7 + 0.3 * Math.sin(ts * 0.008);

        ctx.save();
        ctx.shadowColor = "hsl(0, 100%, 70%)";
        ctx.shadowBlur = 12 * pulse;
        ctx.font = `${TILE}px serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(fruitRef.current.symbol, fx, fy);
        ctx.restore();
      }

      // Player
      if (state !== "dying" || dyingTRef.current > 500) {
        const ppx = p.x * TILE + TILE / 2;
        const ppy = p.y * TILE + TILE / 2;
        const mouth = 0.3 + 0.2 * Math.sin(ts * 0.015);
        let angle = 0;
        if (p.dir === "DOWN") angle = Math.PI / 2;
        else if (p.dir === "LEFT") angle = Math.PI;
        else if (p.dir === "UP") angle = -Math.PI / 2;

        ctx.save();
        ctx.fillStyle = "hsl(50, 100%, 55%)";
        ctx.shadowColor = "hsl(50, 100%, 55%)";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(ppx, ppy, TILE / 2 - 1, angle + mouth, angle + Math.PI * 2 - mouth);
        ctx.lineTo(ppx, ppy);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        const progress = 1 - dyingTRef.current / 500;
        const ppx = p.x * TILE + TILE / 2;
        const ppy = p.y * TILE + TILE / 2;
        ctx.save();
        ctx.fillStyle = "hsl(50, 100%, 55%)";
        ctx.shadowColor = "hsl(50, 100%, 55%)";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(ppx, ppy, (TILE / 2 - 1) * (1 - progress), progress * Math.PI, Math.PI * 2 + progress * Math.PI);
        ctx.lineTo(ppx, ppy);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Ghosts
      for (const g of ghosts) {
        const gx_ = g.x * TILE + TILE / 2;
        const gy_ = g.y * TILE + TILE / 2;
        const r = TILE / 2 - 1;

        ctx.save();

        if (g.mode === "eaten") {
          // Eaten: draw ONLY glowing eyes, no body
          const eox = DX[g.dir] * 2, eoy = DY[g.dir] * 2;
          ctx.fillStyle = "white";
          ctx.shadowColor = "hsl(190, 100%, 70%)";
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(gx_ - 3, gy_ - 3, 3, 0, Math.PI * 2);
          ctx.arc(gx_ + 3, gy_ - 3, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "hsl(220, 80%, 20%)";
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.arc(gx_ - 3 + eox, gy_ - 3 + eoy, 1.5, 0, Math.PI * 2);
          ctx.arc(gx_ + 3 + eox, gy_ - 3 + eoy, 1.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          continue;
        }

        if (g.mode === "frightened") {
          const flash = g.frightenedTimer < 2000 && Math.floor(ts / 200) % 2 === 0;
          ctx.fillStyle = flash ? "hsl(0, 0%, 90%)" : "hsl(220, 80%, 60%)";
          ctx.shadowColor = flash ? "hsl(0, 0%, 90%)" : "hsl(220, 80%, 60%)";
        } else {
          ctx.fillStyle = g.color;
          ctx.shadowColor = g.color;
        }
        ctx.shadowBlur = 8;

        // Body
        ctx.beginPath();
        ctx.arc(gx_, gy_ - 2, r, Math.PI, 0);
        ctx.lineTo(gx_ + r, gy_ + r);
        const wave = Math.sin(ts * 0.01) * 2;
        for (let i = 0; i < 3; i++) {
          const wx = gx_ + r - (i + 1) * (r * 2 / 3);
          ctx.quadraticCurveTo(wx + r / 3, gy_ + r + wave * (i % 2 === 0 ? 1 : -1), wx, gy_ + r);
        }
        ctx.closePath();
        ctx.fill();

        // Eyes
        if (g.mode !== "frightened") {
          const eox = DX[g.dir] * 2, eoy = DY[g.dir] * 2;
          ctx.fillStyle = "white";
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.arc(gx_ - 3, gy_ - 3, 3, 0, Math.PI * 2);
          ctx.arc(gx_ + 3, gy_ - 3, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "hsl(220, 80%, 20%)";
          ctx.beginPath();
          ctx.arc(gx_ - 3 + eox, gy_ - 3 + eoy, 1.5, 0, Math.PI * 2);
          ctx.arc(gx_ + 3 + eox, gy_ - 3 + eoy, 1.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.strokeStyle = "white";
          ctx.lineWidth = 1;
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.arc(gx_ - 3, gy_ - 3, 1.5, 0, Math.PI * 2);
          ctx.arc(gx_ + 3, gy_ - 3, 1.5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(gx_ - 4, gy_ + 2);
          for (let i = 0; i < 4; i++) ctx.lineTo(gx_ - 4 + i * 2 + 1, gy_ + (i % 2 === 0 ? 0 : 4));
          ctx.stroke();
        }
        ctx.restore();
      }

      // Score Popups
      for (const pop of popupsRef.current) {
        const alpha = pop.timer / pop.maxTimer;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "hsl(50, 100%, 80%)";
        ctx.shadowColor = "hsl(50, 100%, 60%)";
        ctx.shadowBlur = 8;
        ctx.font = "bold 10px 'Press Start 2P'";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(pop.text, pop.x, pop.y);
        ctx.restore();
      }

      // Lives
      ctx.save();
      for (let i = 0; i < livesRef.current; i++) {
        ctx.fillStyle = "hsl(50, 100%, 55%)";
        ctx.beginPath();
        ctx.arc(20 + i * 20, H - 10, 6, 0.3, Math.PI * 2 - 0.3);
        ctx.lineTo(20 + i * 20, H - 10);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // Level
      ctx.save();
      ctx.fillStyle = "hsla(190, 100%, 50%, 0.6)";
      ctx.font = "9px 'Press Start 2P'";
      ctx.textAlign = "right";
      ctx.fillText(`LV ${levelRef.current}`, W - 10, H - 6);
      ctx.restore();
    };

    loopRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(loopRef.current);
  }, [resetPos, nextLvl, spawnPopup]);

  const dpad = (dir: Direction) => (e: React.TouchEvent) => {
    e.preventDefault();
    bufDir(dir);
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
                  <button key={s} onClick={() => handleScheme(s)} className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors ${controlScheme === s ? "bg-primary/20 text-primary neon-text-cyan font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}>
                    <span className="font-pixel text-[9px]">{CTRL_LABEL[s]}</span>
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
      <div className="relative" style={{ width: W, height: H }}>
        <canvas ref={canvasRef} width={W} height={H} className="rounded-lg block" style={{ imageRendering: "pixelated" }} />

        {gameState === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center glass rounded-lg">
            <h2 className="font-pixel text-sm text-neon-yellow neon-text-cyan mb-4">PHANTOM MAZE</h2>
            <p className="text-muted-foreground text-sm mb-6 text-center px-4">{CTRL_HINT[controlScheme]}</p>
            <button onClick={startGame} className="bg-secondary text-secondary-foreground font-pixel text-[10px] px-6 py-3 rounded-lg neon-glow-pink hover:scale-105 active:scale-95 transition-transform">
              START GAME
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
