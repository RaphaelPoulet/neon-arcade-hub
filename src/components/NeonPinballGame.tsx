import { useRef, useEffect, useState, useCallback } from "react";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import GameOverLeaderboard from "@/components/GameOverLeaderboard";
import pinballBg from "@/assets/pinball-bg.jpg";

// ============================================================
// NEON PINBALL — Phase 1.1: sealed walls, instant launch, bumpers
// ============================================================

type GameState = "idle" | "ready" | "playing" | "gameover";
type ControlScheme = "arrows" | "qwerty" | "azerty";

const WIDTH = 500;
const HEIGHT = 800;

// --- Physics ---
const GRAVITY = 1400;
const RESTITUTION = 0.75;
const FLIPPER_RESTITUTION = 0.55;
const BUMPER_RESTITUTION = 1.4;
const FRICTION = 0.999;
const MAX_SPEED = 2400;
const SUBSTEPS = 6;

// --- Ball ---
const BALL_R = 11;

// --- Launcher lane ---
const LANE_W = 30;
const LANE_X = WIDTH - LANE_W / 2 - 4;      // center of lane
const LANE_INNER_X = WIDTH - LANE_W - 8;    // inner wall x
const LANE_TOP_Y = 140;
const LANE_BOTTOM_Y = HEIGHT - 40;          // lane goes almost to bottom
const LAUNCH_IMPULSE = 3400;                // instant upward velocity on Space

// --- Flippers ---
const FLIPPER_LEN = 78;
const FLIPPER_W = 14;
const PIVOT_Y = 700;
const PIVOT_L_X = 140;
const PIVOT_R_X = 330;
const REST_ANGLE = (28 * Math.PI) / 180;
const ACTIVE_ANGLE = (32 * Math.PI) / 180;
const FLIPPER_UP_SPEED = 28;
const FLIPPER_DOWN_SPEED = 14;

// --- Bumpers ---
interface Bumper { x: number; y: number; r: number; flash: number; }
const BUMPERS_INIT: Bumper[] = [
  { x: 140, y: 230, r: 26, flash: 0 },
  { x: 320, y: 200, r: 26, flash: 0 },
  { x: 230, y: 340, r: 28, flash: 0 },
];

// --- Walls ---
interface Wall { x1: number; y1: number; x2: number; y2: number; halfW?: number; accent?: "cyan" | "magenta"; }
const WALL_HALF = 7; // physical half-thickness for outer walls
const INNER_HALF = 5;
const WALLS: Wall[] = [
  // outer left
  { x1: 0, y1: 0, x2: 0, y2: HEIGHT, halfW: WALL_HALF, accent: "cyan" },
  // outer right
  { x1: WIDTH, y1: 0, x2: WIDTH, y2: HEIGHT, halfW: WALL_HALF, accent: "magenta" },
  // top arch
  { x1: 0, y1: 120, x2: 90, y2: 40, halfW: WALL_HALF, accent: "cyan" },
  { x1: 90, y1: 40, x2: WIDTH - 90, y2: 40, halfW: WALL_HALF, accent: "cyan" },
  { x1: WIDTH - 90, y1: 40, x2: WIDTH, y2: 120, halfW: WALL_HALF, accent: "magenta" },
  // launcher inner wall (full lane, top to bottom)
  { x1: LANE_INNER_X, y1: LANE_TOP_Y, x2: LANE_INNER_X, y2: LANE_BOTTOM_Y, halfW: WALL_HALF, accent: "magenta" },
  // curved rail from lane top into playfield (one-way deflector)
  { x1: LANE_INNER_X, y1: LANE_TOP_Y, x2: WIDTH - 90, y2: 80, halfW: WALL_HALF, accent: "magenta" },
  // bottom-left slope: from outer wall directly to left pivot (sealed)
  { x1: 0, y1: HEIGHT - 160, x2: PIVOT_L_X, y2: PIVOT_Y, halfW: WALL_HALF, accent: "cyan" },
  // bottom-right slope: from launcher inner wall directly to right pivot (sealed)
  { x1: LANE_INNER_X, y1: HEIGHT - 200, x2: PIVOT_R_X, y2: PIVOT_Y, halfW: WALL_HALF, accent: "magenta" },
  // bottom floor pieces from outer walls up to slope start (side outlanes closed)
  { x1: 0, y1: HEIGHT, x2: 0, y2: HEIGHT - 160, halfW: WALL_HALF, accent: "cyan" },
  { x1: LANE_INNER_X, y1: HEIGHT - 200, x2: LANE_INNER_X, y2: LANE_BOTTOM_Y, halfW: WALL_HALF, accent: "magenta" },

  // --- Internal guide walls ---
  // Left slanted deflector (funnels toward left bumper)
  { x1: 30, y1: 190, x2: 78, y2: 300, halfW: INNER_HALF, accent: "cyan" },
  // Right slanted deflector (funnels toward right bumper)
  { x1: 405, y1: 200, x2: 360, y2: 305, halfW: INNER_HALF, accent: "magenta" },
  // Center chevron above middle bumper (inverted V)
  { x1: 195, y1: 425, x2: 230, y2: 395, halfW: INNER_HALF, accent: "cyan" },
  { x1: 230, y1: 395, x2: 265, y2: 425, halfW: INNER_HALF, accent: "magenta" },
  // Short guide rails above flippers to prevent easy drain along walls
  { x1: 60, y1: HEIGHT - 260, x2: 105, y2: HEIGHT - 210, halfW: INNER_HALF, accent: "cyan" },
  { x1: LANE_INNER_X - 20, y1: HEIGHT - 260, x2: LANE_INNER_X - 65, y2: HEIGHT - 210, halfW: INNER_HALF, accent: "magenta" },
];

// Drain zone: ONLY between the two flipper pivots
const DRAIN_Y = HEIGHT - 10;
const DRAIN_X_MIN = PIVOT_L_X + 8;
const DRAIN_X_MAX = PIVOT_R_X - 8;

// --- Controls ---
type Action = "leftFlip" | "rightFlip" | "launch";
const CONTROL_MAPS: Record<ControlScheme, Record<string, Action>> = {
  arrows: { ArrowLeft: "leftFlip", ArrowRight: "rightFlip", " ": "launch" },
  qwerty: { a: "leftFlip", A: "leftFlip", l: "rightFlip", L: "rightFlip", " ": "launch" },
  azerty: { q: "leftFlip", Q: "leftFlip", m: "rightFlip", M: "rightFlip", " ": "launch" },
};
const CONTROL_LABELS: Record<ControlScheme, string> = {
  arrows: "Arrows", qwerty: "A / L", azerty: "Q / M",
};
const HINT: Record<ControlScheme, string> = {
  arrows: "← left flipper  → right flipper  SPACE launch",
  qwerty: "A left flipper  L right flipper  SPACE launch",
  azerty: "Q flipper gauche  M flipper droit  ESPACE lancer",
};

const C = {
  bg: "hsl(240, 40%, 6%)",
  playfield: "hsl(255, 45%, 10%)",
  wall: "hsl(190, 100%, 60%)",
  wallGlow: "hsla(190, 100%, 60%, 0.35)",
  ball: "hsl(50, 100%, 75%)",
  ballGlow: "hsla(50, 100%, 65%, 0.6)",
  flipper: "hsl(320, 100%, 60%)",
  flipperGlow: "hsla(320, 100%, 60%, 0.5)",
  drain: "hsla(0, 90%, 55%, 0.25)",
  bumper: "hsl(280, 100%, 65%)",
  bumperGlow: "hsla(280, 100%, 70%, 0.7)",
  bumperFlash: "hsl(60, 100%, 85%)",
};

function segClosestPoint(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return { x: x1, y: y1, t: 0 };
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return { x: x1 + t * dx, y: y1 + t * dy, t };
}

interface Ball { x: number; y: number; vx: number; vy: number; alive: boolean; }

const NeonPinballGame = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const [gameState, setGameState] = useState<GameState>("idle");
  const stateRef = useRef<GameState>("idle");
  useEffect(() => { stateRef.current = gameState; }, [gameState]);

  const [controlScheme, setControlScheme] = useState<ControlScheme>(() =>
    (localStorage.getItem("arcade-control-scheme") as ControlScheme) || "arrows"
  );
  const controlRef = useRef(controlScheme);
  useEffect(() => { controlRef.current = controlScheme; }, [controlScheme]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);
  const [ballNum, setBallNum] = useState(1);
  const ballNumRef = useRef(1);
  const [highScore, setHighScore] = useState<number>(() => {
    const s = localStorage.getItem("neon-pinball-hi");
    return s ? parseInt(s) : 0;
  });

  const ballRef = useRef<Ball>({ x: LANE_X, y: LANE_BOTTOM_Y - BALL_R - 4, vx: 0, vy: 0, alive: false });
  const bumpersRef = useRef<Bumper[]>(BUMPERS_INIT.map(b => ({ ...b })));

  const leftFlipRef = useRef({ angle: -REST_ANGLE, target: -REST_ANGLE, omega: 0 });
  const rightFlipRef = useRef({ angle: -REST_ANGLE, target: -REST_ANGLE, omega: 0 });

  const keysRef = useRef<Record<Action, boolean>>({ leftFlip: false, rightFlip: false, launch: false });

  const startGameRef = useRef<() => void>(() => {});

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const a = CONTROL_MAPS[controlRef.current][e.key];
      if (a) {
        e.preventDefault();
        if (!keysRef.current[a]) {
          keysRef.current[a] = true;
          if (a === "leftFlip") leftFlipRef.current.target = ACTIVE_ANGLE;
          if (a === "rightFlip") rightFlipRef.current.target = ACTIVE_ANGLE;
          if (a === "launch") {
            if (stateRef.current === "ready" && ballRef.current.alive) {
              ballRef.current.vy = -LAUNCH_IMPULSE;
              ballRef.current.vx = 0;
              setGameState("playing");
            }
          }
        }
      }
      if (e.key === "Enter" && (stateRef.current === "idle" || stateRef.current === "gameover")) {
        startGameRef.current();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const a = CONTROL_MAPS[controlRef.current][e.key];
      if (a) {
        e.preventDefault();
        keysRef.current[a] = false;
        if (a === "leftFlip") leftFlipRef.current.target = -REST_ANGLE;
        if (a === "rightFlip") rightFlipRef.current.target = -REST_ANGLE;
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

  const resetBallToLauncher = useCallback(() => {
    ballRef.current = { x: LANE_X, y: LANE_BOTTOM_Y - BALL_R - 4, vx: 0, vy: 0, alive: true };
    setGameState("ready");
  }, []);

  const startGame = useCallback(() => {
    scoreRef.current = 0;
    ballNumRef.current = 1;
    setScore(0);
    setBallNum(1);
    bumpersRef.current = BUMPERS_INIT.map(b => ({ ...b }));
    resetBallToLauncher();
  }, [resetBallToLauncher]);
  useEffect(() => { startGameRef.current = startGame; }, [startGame]);

  const handleSchemeChange = (s: ControlScheme) => {
    setControlScheme(s);
    localStorage.setItem("arcade-control-scheme", s);
    setSettingsOpen(false);
    toast(`Controls: ${CONTROL_LABELS[s]}`, { duration: 1500, className: "font-pixel" });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let last = performance.now();

    const frame = (now: number) => {
      rafRef.current = requestAnimationFrame(frame);
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      step(dt);
      render(ctx);
    };

    const flipperEndpoints = () => {
      const L = leftFlipRef.current.angle;
      const R = rightFlipRef.current.angle;
      const lx = PIVOT_L_X + Math.cos(L) * FLIPPER_LEN;
      const ly = PIVOT_Y - Math.sin(L) * FLIPPER_LEN;
      const ra = Math.PI - R;
      const rx = PIVOT_R_X + Math.cos(ra) * FLIPPER_LEN;
      const ry = PIVOT_Y - Math.sin(ra) * FLIPPER_LEN;
      return { lx, ly, rx, ry };
    };

    const collideSeg = (
      b: Ball, x1: number, y1: number, x2: number, y2: number,
      restitution: number, extraVel?: { vx: number; vy: number }
    ) => {
      const cp = segClosestPoint(b.x, b.y, x1, y1, x2, y2);
      const dx = b.x - cp.x;
      const dy = b.y - cp.y;
      const d2 = dx * dx + dy * dy;
      const r = BALL_R;
      if (d2 > r * r) return false;
      const dist = Math.sqrt(d2) || 0.0001;
      const nx = dx / dist, ny = dy / dist;
      b.x += nx * (r - dist);
      b.y += ny * (r - dist);
      let rvx = b.vx, rvy = b.vy;
      if (extraVel) { rvx -= extraVel.vx; rvy -= extraVel.vy; }
      const vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        const j = -(1 + restitution) * vn;
        b.vx += j * nx; b.vy += j * ny;
        if (extraVel) { b.vx += extraVel.vx * 0.4; b.vy += extraVel.vy * 0.4; }
        return true;
      }
      return false;
    };

    const collideBumper = (b: Ball, bm: Bumper) => {
      const dx = b.x - bm.x, dy = b.y - bm.y;
      const rSum = BALL_R + bm.r;
      const d2 = dx * dx + dy * dy;
      if (d2 > rSum * rSum) return false;
      const dist = Math.sqrt(d2) || 0.0001;
      const nx = dx / dist, ny = dy / dist;
      b.x = bm.x + nx * rSum;
      b.y = bm.y + ny * rSum;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        const j = -(1 + BUMPER_RESTITUTION) * vn;
        b.vx += j * nx; b.vy += j * ny;
        // extra kick
        b.vx += nx * 120; b.vy += ny * 120;
        bm.flash = 0.25;
        scoreRef.current += 100;
        return true;
      }
      return false;
    };

    const step = (dt: number) => {
      const updateFlip = (f: { angle: number; target: number; omega: number }) => {
        const diff = f.target - f.angle;
        const speed = f.target > f.angle ? FLIPPER_UP_SPEED : FLIPPER_DOWN_SPEED;
        const delta = Math.sign(diff) * Math.min(Math.abs(diff), speed * dt);
        const oldAngle = f.angle;
        f.angle += delta;
        f.omega = (f.angle - oldAngle) / dt;
      };
      updateFlip(leftFlipRef.current);
      updateFlip(rightFlipRef.current);

      // decay bumper flashes
      for (const bm of bumpersRef.current) if (bm.flash > 0) bm.flash = Math.max(0, bm.flash - dt);

      if (stateRef.current !== "playing" && stateRef.current !== "ready") return;
      const b = ballRef.current;
      if (!b.alive) return;

      if (stateRef.current === "ready") {
        b.x = LANE_X;
        b.y = LANE_BOTTOM_Y - BALL_R - 4;
        b.vx = 0; b.vy = 0;
        return;
      }

      const sdt = dt / SUBSTEPS;
      for (let s = 0; s < SUBSTEPS; s++) {
        b.vy += GRAVITY * sdt;
        b.vx *= FRICTION;
        b.vy *= FRICTION;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > MAX_SPEED) { b.vx *= MAX_SPEED / sp; b.vy *= MAX_SPEED / sp; }
        b.x += b.vx * sdt;
        b.y += b.vy * sdt;

        for (const w of WALLS) collideSeg(b, w.x1, w.y1, w.x2, w.y2, RESTITUTION);

        const { lx, ly, rx, ry } = flipperEndpoints();
        {
          const cp = segClosestPoint(b.x, b.y, PIVOT_L_X, PIVOT_Y, lx, ly);
          const w = leftFlipRef.current.omega;
          const rX = cp.x - PIVOT_L_X, rY = cp.y - PIVOT_Y;
          if (collideSeg(b, PIVOT_L_X, PIVOT_Y, lx, ly, FLIPPER_RESTITUTION, { vx: w * rY, vy: -w * rX })) {
            scoreRef.current += 20;
          }
        }
        {
          const cp = segClosestPoint(b.x, b.y, PIVOT_R_X, PIVOT_Y, rx, ry);
          const w = rightFlipRef.current.omega;
          const rrX = cp.x - PIVOT_R_X, rrY = cp.y - PIVOT_Y;
          if (collideSeg(b, PIVOT_R_X, PIVOT_Y, rx, ry, FLIPPER_RESTITUTION, { vx: -w * rrY, vy: w * rrX })) {
            scoreRef.current += 20;
          }
          void cp;
        }

        for (const bm of bumpersRef.current) collideBumper(b, bm);

        // drain — only between flipper pivots
        if (b.y > DRAIN_Y && b.x > DRAIN_X_MIN && b.x < DRAIN_X_MAX) {
          b.alive = false;
          onBallLost();
          break;
        }
        // safety: if ball somehow leaves screen bottom outside drain, respawn
        if (b.y > HEIGHT + 40) {
          b.alive = false;
          onBallLost();
          break;
        }
      }
    };

    const onBallLost = () => {
      if (ballNumRef.current >= 3) {
        if (scoreRef.current > highScore) {
          setHighScore(scoreRef.current);
          localStorage.setItem("neon-pinball-hi", String(scoreRef.current));
        }
        setScore(scoreRef.current);
        setGameState("gameover");
      } else {
        ballNumRef.current += 1;
        setBallNum(ballNumRef.current);
        setScore(scoreRef.current);
        setTimeout(() => resetBallToLauncher(), 400);
      }
    };

    const render = (ctx: CanvasRenderingContext2D) => {
      // Deep obsidian base
      ctx.fillStyle = "hsl(240, 30%, 3%)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      // Rich radial gradient — obsidian core → midnight blue → deep neon purple edges
      const g = ctx.createRadialGradient(WIDTH / 2, HEIGHT * 0.42, 30, WIDTH / 2, HEIGHT * 0.5, HEIGHT * 0.95);
      g.addColorStop(0, "hsl(230, 55%, 9%)");
      g.addColorStop(0.55, "hsl(245, 60%, 7%)");
      g.addColorStop(1, "hsl(275, 70%, 5%)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      // Carbon-fiber weave texture (subtle diagonal hatch)
      ctx.save();
      ctx.globalAlpha = 0.05;
      ctx.strokeStyle = "hsl(200, 100%, 70%)";
      ctx.lineWidth = 1;
      for (let i = -HEIGHT; i < WIDTH; i += 6) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + HEIGHT, HEIGHT); ctx.stroke();
      }
      ctx.globalAlpha = 0.035;
      ctx.strokeStyle = "hsl(320, 100%, 70%)";
      for (let i = 0; i < WIDTH + HEIGHT; i += 6) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i - HEIGHT, HEIGHT); ctx.stroke();
      }
      ctx.restore();

      // Faint side-art glow columns (arcade cabinet silhouettes)
      const sideL = ctx.createLinearGradient(0, 0, 60, 0);
      sideL.addColorStop(0, "hsla(190, 100%, 55%, 0.18)");
      sideL.addColorStop(1, "hsla(190, 100%, 55%, 0)");
      ctx.fillStyle = sideL;
      ctx.fillRect(0, 0, 60, HEIGHT);
      const sideR = ctx.createLinearGradient(WIDTH, 0, WIDTH - 60, 0);
      sideR.addColorStop(0, "hsla(320, 100%, 60%, 0.18)");
      sideR.addColorStop(1, "hsla(320, 100%, 60%, 0)");
      ctx.fillStyle = sideR;
      ctx.fillRect(WIDTH - 60, 0, 60, HEIGHT);

      // Translucent playfield inset — separates ball/bumpers from bg
      ctx.fillStyle = "hsla(255, 45%, 8%, 0.55)";
      ctx.fillRect(6, 6, WIDTH - 12, HEIGHT - 12);

      // Dark vignette
      const vg = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, HEIGHT * 0.35, WIDTH / 2, HEIGHT / 2, HEIGHT * 0.72);
      vg.addColorStop(0, "hsla(0, 0%, 0%, 0)");
      vg.addColorStop(1, "hsla(0, 0%, 0%, 0.75)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      // drain zone (only between pivots)
      ctx.fillStyle = C.drain;
      ctx.fillRect(DRAIN_X_MIN, DRAIN_Y - 4, DRAIN_X_MAX - DRAIN_X_MIN, HEIGHT - DRAIN_Y + 4);

      // walls
      ctx.shadowBlur = 12;
      ctx.shadowColor = C.wallGlow;
      ctx.strokeStyle = C.wall;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      for (const w of WALLS) {
        ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // bumpers
      for (const bm of bumpersRef.current) {
        const flashing = bm.flash > 0;
        ctx.shadowBlur = flashing ? 40 : 20;
        ctx.shadowColor = flashing ? C.bumperFlash : C.bumperGlow;
        const grad = ctx.createRadialGradient(bm.x - 4, bm.y - 4, 2, bm.x, bm.y, bm.r);
        grad.addColorStop(0, flashing ? C.bumperFlash : "hsl(300, 100%, 85%)");
        grad.addColorStop(1, C.bumper);
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(bm.x, bm.y, bm.r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "hsla(0,0%,100%,0.6)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(bm.x, bm.y, bm.r - 4, 0, Math.PI * 2); ctx.stroke();
      }

      // launcher chute hint
      ctx.strokeStyle = "hsla(50, 100%, 60%, 0.4)";
      ctx.lineWidth = 1;
      ctx.strokeRect(LANE_X - 12, LANE_BOTTOM_Y - 60, 24, 50);
      ctx.fillStyle = "hsla(50, 100%, 60%, 0.15)";
      ctx.fillRect(LANE_X - 12, LANE_BOTTOM_Y - 60, 24, 50);

      // flippers
      const drawFlipper = (px: number, py: number, angle: number, mirror: boolean) => {
        const a = mirror ? Math.PI - angle : angle;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(-a);
        ctx.shadowBlur = 16;
        ctx.shadowColor = C.flipperGlow;
        ctx.fillStyle = C.flipper;
        const r = FLIPPER_W / 2;
        ctx.beginPath();
        ctx.arc(0, 0, r, Math.PI / 2, -Math.PI / 2, false);
        ctx.lineTo(FLIPPER_LEN, -r * 0.55);
        ctx.arc(FLIPPER_LEN, 0, r * 0.55, -Math.PI / 2, Math.PI / 2, false);
        ctx.lineTo(0, r);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "hsl(50, 100%, 80%)";
        ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      };
      drawFlipper(PIVOT_L_X, PIVOT_Y, leftFlipRef.current.angle, false);
      drawFlipper(PIVOT_R_X, PIVOT_Y, rightFlipRef.current.angle, true);

      // ball
      const b = ballRef.current;
      if (b.alive) {
        ctx.shadowBlur = 20;
        ctx.shadowColor = C.ballGlow;
        const bg = ctx.createRadialGradient(b.x - 3, b.y - 3, 1, b.x, b.y, BALL_R);
        bg.addColorStop(0, "hsl(60, 100%, 90%)");
        bg.addColorStop(1, C.ball);
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [highScore, resetBallToLauncher]);

  const schemes: ControlScheme[] = ["arrows", "qwerty", "azerty"];

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-[540px] mx-auto px-4">
      <div className="flex items-center justify-between w-full">
        <div className="glass rounded-lg px-3 py-2">
          <span className="text-[9px] text-muted-foreground block">SCORE</span>
          <span className="font-pixel text-sm text-primary neon-text-cyan">{score.toLocaleString()}</span>
        </div>
        <div className="glass rounded-lg px-3 py-2 text-center">
          <span className="text-[9px] text-muted-foreground block">BALL</span>
          <span className="font-pixel text-sm text-neon-yellow">{ballNum}/3</span>
        </div>
        <div className="relative">
          <button
            onClick={() => setSettingsOpen(o => !o)}
            className="glass rounded-lg p-2.5 text-muted-foreground hover:text-primary transition-colors"
            aria-label="Control settings"
          >
            <Settings className="w-4 h-4" />
          </button>
          {settingsOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSettingsOpen(false)} />
              <div className="absolute top-full right-0 mt-2 z-50 glass rounded-lg p-1.5 neon-glow-cyan min-w-[140px]">
                {schemes.map(s => (
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
                      {s === "arrows" ? "← →  SPACE" : s === "qwerty" ? "A  L  SPACE" : "Q  M  ESPACE"}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="glass rounded-lg px-3 py-2 text-right">
          <span className="text-[9px] text-muted-foreground block">HIGH</span>
          <span className="font-pixel text-sm text-secondary neon-text-pink">{highScore.toLocaleString()}</span>
        </div>
      </div>

      <div
        className="relative rounded-lg overflow-hidden neon-glow-cyan"
        style={{ width: "100%", maxWidth: WIDTH, aspectRatio: `${WIDTH} / ${HEIGHT}` }}
      >
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="block w-full h-full" />

        {gameState === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center glass">
            <h2 className="font-pixel text-sm text-secondary neon-text-pink mb-2">NEON PINBALL</h2>
            <p className="text-[10px] text-muted-foreground mb-1">3 BALLS · CLASSIC ARCADE</p>
            <p className="text-[10px] text-muted-foreground mb-4 text-center px-6">{HINT[controlScheme]}</p>
            <button
              onClick={startGame}
              className="bg-secondary text-secondary-foreground font-pixel text-[10px] px-6 py-3 rounded-lg neon-glow-pink hover:scale-105 active:scale-95 transition-transform"
            >
              INSERT COIN
            </button>
            {highScore > 0 && (
              <p className="font-pixel text-[9px] text-neon-yellow mt-4">HI {highScore.toLocaleString()}</p>
            )}
          </div>
        )}

        {gameState === "ready" && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 glass rounded-md px-3 py-1.5 font-pixel text-[9px] text-neon-yellow animate-pulse-neon pointer-events-none">
            PRESS SPACE TO LAUNCH
          </div>
        )}

        {gameState === "gameover" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center glass overflow-y-auto py-4">
            <h2 className="font-pixel text-sm text-secondary neon-text-pink mb-2">GAME OVER</h2>
            <p className="font-pixel text-xs text-primary neon-text-cyan mb-3">{score.toLocaleString()}</p>
            <GameOverLeaderboard gameId="pinball" score={score} />
            <button
              onClick={startGame}
              className="bg-secondary text-secondary-foreground font-pixel text-[10px] px-6 py-3 rounded-lg neon-glow-pink hover:scale-105 active:scale-95 transition-transform mt-3"
            >
              INSERT COIN TO REPLAY
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default NeonPinballGame;
