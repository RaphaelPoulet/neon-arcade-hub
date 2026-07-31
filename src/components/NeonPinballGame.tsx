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
const RESTITUTION = 0.62;
const FLIPPER_RESTITUTION = 0.55;
const BUMPER_RESTITUTION = 1.15;
const FRICTION = 0.9955; // playfield rolling friction (per sub-step) — tames hyper-speed
const MAX_SPEED = 3400;
const SUBSTEPS = 6;

// --- Ball ---
const BALL_R = 11;

// --- Launcher lane ---
const LANE_W = 44;
const LANE_X = WIDTH - LANE_W / 2 - 4;      // center of lane
const LANE_INNER_X = WIDTH - LANE_W - 8;    // inner wall x (widened lane)
const LANE_TOP_Y = 170;                     // curve starts lower for a longer, wider ejection arc
const LANE_BOTTOM_Y = HEIGHT - 40;          // lane goes almost to bottom
const LAUNCH_IMPULSE = 11000;               // instant upward velocity on Space (hyper-speed plunger)

// --- One-way anti-drain gate (high, 45° angled, just before the upper-right turn) ---
const GATE_AX = LANE_INNER_X;               // lower-left end (on the magenta inner wall)
const GATE_AY = LANE_TOP_Y + 1;
const GATE_BX = WIDTH;                      // upper-right end (on the outer wall)
const GATE_BY = LANE_TOP_Y - 51;            // 45° tilt up-and-right
const GATE_CX = (GATE_AX + GATE_BX) / 2;
const GATE_CY = (GATE_AY + GATE_BY) / 2;
const GATE_HALF = 6;
const GATE_OPEN_TIME = 0.35;                // seconds the shutters stay open after the ball pushes through

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
const WALL_HALF = 10; // physical half-thickness for outer walls (thickened for premium cabinet feel)
const INNER_HALF = 7;
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
  // (central triangular obstacle is defined separately below — see TRI_*)

  // Short guide rails above flippers to prevent easy drain along walls
  { x1: 60, y1: HEIGHT - 260, x2: 105, y2: HEIGHT - 210, halfW: INNER_HALF, accent: "cyan" },
  { x1: LANE_INNER_X - 20, y1: HEIGHT - 260, x2: LANE_INNER_X - 65, y2: HEIGHT - 210, halfW: INNER_HALF, accent: "magenta" },
];

// --- Central sculpted triangular obstacle (solid body, rounded corners, curved edges) ---
// Positioned well BELOW the central bumper (y 340, r 28) for a large clear gap.
// Scaled to 50% and recentred in the mid-field between the bumpers and the flippers.
const TRI_APEX_X = 230;
const TRI_APEX_Y = 471;
const TRI_HALF_W = 28;
const TRI_BASE_Y = 509;
const TRI_EDGE_HALF = 5;          // physical half-thickness of each edge (rounded body)
const TRI_BULGE = 4.5;            // outward curvature of each edge (organic, non-straight)
const TRI_PTS: [number, number][] = [
  [TRI_APEX_X, TRI_APEX_Y],
  [TRI_APEX_X + TRI_HALF_W, TRI_BASE_Y],
  [TRI_APEX_X - TRI_HALF_W, TRI_BASE_Y],
];
const TRI_CX = (TRI_PTS[0][0] + TRI_PTS[1][0] + TRI_PTS[2][0]) / 3;
const TRI_CY = (TRI_PTS[0][1] + TRI_PTS[1][1] + TRI_PTS[2][1]) / 3;
// Collision polyline: each curved edge sampled into small segments (solid, no tunneling)
const TRI_SEGS: { x1: number; y1: number; x2: number; y2: number }[] = (() => {
  const segs: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const SAMPLES = 8;
  for (let i = 0; i < 3; i++) {
    const [ax, ay] = TRI_PTS[i];
    const [bx, by] = TRI_PTS[(i + 1) % 3];
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    // control point pushed outward from the centroid → convex, curved edge
    const ox = mx - TRI_CX, oy = my - TRI_CY;
    const ol = Math.hypot(ox, oy) || 1;
    const cx = mx + (ox / ol) * TRI_BULGE * 2;
    const cy = my + (oy / ol) * TRI_BULGE * 2;
    let px = ax, py = ay;
    for (let s = 1; s <= SAMPLES; s++) {
      const t = s / SAMPLES;
      const it = 1 - t;
      const qx = it * it * ax + 2 * it * t * cx + t * t * bx;
      const qy = it * it * ay + 2 * it * t * cy + t * t * by;
      segs.push({ x1: px, y1: py, x2: qx, y2: qy });
      px = qx; py = qy;
    }
  }
  return segs;
})();



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

// Closest point on segment A (the ball's swept path) to segment B (a solid body edge).
function segSegClosest(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx2: number, dy2: number
) {
  let best = { t: 0, px: ax, py: ay, dist: Infinity };
  const N = 12;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const px = ax + (bx - ax) * t;
    const py = ay + (by - ay) * t;
    const cp = segClosestPoint(px, py, cx, cy, dx2, dy2);
    const d = Math.hypot(px - cp.x, py - cp.y);
    if (d < best.dist) best = { t, px, py, dist: d };
  }
  return best;
}


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
  const gateOpenRef = useRef(0); // >0 = shutters swung open
  const trailRef = useRef<{ x: number; y: number }[]>([]);

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
              gateOpenRef.current = GATE_OPEN_TIME;
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
    const bgImg = new Image();
    bgImg.src = pinballBg;

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
      restitution: number, extraVel?: { vx: number; vy: number }, halfW = 0
    ) => {
      const cp = segClosestPoint(b.x, b.y, x1, y1, x2, y2);
      const dx = b.x - cp.x;
      const dy = b.y - cp.y;
      const d2 = dx * dx + dy * dy;
      const r = BALL_R + halfW;
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
      if (gateOpenRef.current > 0) gateOpenRef.current = Math.max(0, gateOpenRef.current - dt);

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
        const prevX = b.x, prevY = b.y;
        b.x += b.vx * sdt;
        b.y += b.vy * sdt;

        for (const w of WALLS) collideSeg(b, w.x1, w.y1, w.x2, w.y2, RESTITUTION, undefined, w.halfW ?? 0);

        // Central solid triangular obstacle (curved edges, rounded corners)
        for (const t of TRI_SEGS) collideSeg(b, t.x1, t.y1, t.x2, t.y2, RESTITUTION, undefined, TRI_EDGE_HALF);

        // One-way gate: blocks the ball from rolling back down the ramp.
        // Swings open while the ball travels upward through it.
        if (b.vy < 0 && Math.hypot(b.x - GATE_CX, b.y - GATE_CY) < 70) {
          gateOpenRef.current = GATE_OPEN_TIME;
        }
        if (gateOpenRef.current <= 0 && b.vy > 0) {
          collideSeg(b, GATE_AX, GATE_AY, GATE_BX, GATE_BY, 0.35, undefined, GATE_HALF);
        }

        // --- Flippers: solid thick capsule bodies with swept (continuous) collision ---
        const { lx, ly, rx, ry } = flipperEndpoints();
        const FLIP_HALF = FLIPPER_W / 2;
        const hitFlipper = (
          px: number, py: number, ex: number, ey: number,
          omega: number, sign: number
        ) => {
          // Continuous check: if the swept path grazed the flipper body, rewind onto it.
          const near = segSegClosest(prevX, prevY, b.x, b.y, px, py, ex, ey);
          if (near.dist < BALL_R + FLIP_HALF) {
            b.x = near.px; b.y = near.py;
          }
          const cp = segClosestPoint(b.x, b.y, px, py, ex, ey);
          const rX = cp.x - px, rY = cp.y - py;
          const surfVel = { vx: sign * omega * rY, vy: -sign * omega * rX };
          if (collideSeg(b, px, py, ex, ey, FLIPPER_RESTITUTION, surfVel, FLIP_HALF)) {
            scoreRef.current += 20;
          }
        };
        hitFlipper(PIVOT_L_X, PIVOT_Y, lx, ly, leftFlipRef.current.omega, 1);
        hitFlipper(PIVOT_R_X, PIVOT_Y, rx, ry, rightFlipRef.current.omega, -1);


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

      // Rock guitarist stage background art
      if (bgImg.complete && bgImg.naturalWidth > 0) {
        ctx.drawImage(bgImg, 0, 0, WIDTH, HEIGHT);
      }

      // Purple wash + vignette to keep playfield readable
      const wash = ctx.createRadialGradient(WIDTH / 2, HEIGHT * 0.55, 60, WIDTH / 2, HEIGHT / 2, HEIGHT * 0.85);
      wash.addColorStop(0, "hsla(260, 60%, 8%, 0.55)");
      wash.addColorStop(1, "hsla(275, 80%, 4%, 0.85)");
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      // Faint side glow columns
      const sideL = ctx.createLinearGradient(0, 0, 60, 0);
      sideL.addColorStop(0, "hsla(190, 100%, 55%, 0.22)");
      sideL.addColorStop(1, "hsla(190, 100%, 55%, 0)");
      ctx.fillStyle = sideL;
      ctx.fillRect(0, 0, 60, HEIGHT);
      const sideR = ctx.createLinearGradient(WIDTH, 0, WIDTH - 60, 0);
      sideR.addColorStop(0, "hsla(320, 100%, 60%, 0.22)");
      sideR.addColorStop(1, "hsla(320, 100%, 60%, 0)");
      ctx.fillStyle = sideR;
      ctx.fillRect(WIDTH - 60, 0, 60, HEIGHT);

      // drain zone (only between pivots)
      ctx.fillStyle = C.drain;
      ctx.fillRect(DRAIN_X_MIN, DRAIN_Y - 4, DRAIN_X_MAX - DRAIN_X_MIN, HEIGHT - DRAIN_Y + 4);

      // Thick sculpted neon walls — drop shadow, beveled body, specular highlight, chevron accents
      ctx.lineCap = "round";
      for (const w of WALLS) {
        const half = w.halfW ?? 4;
        const thickness = half * 2;
        const isMag = w.accent === "magenta";
        const hue = isMag ? 320 : 190;
        const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const nx = -uy, ny = ux;

        // Drop shadow beneath the wall (offset down-right)
        ctx.save();
        ctx.shadowBlur = 10;
        ctx.shadowColor = "rgba(0,0,0,0.85)";
        ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 4;
        ctx.strokeStyle = "rgba(0,0,0,0.9)";
        ctx.lineWidth = thickness;
        ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke();
        ctx.restore();

        // Outer neon glow halo
        ctx.save();
        ctx.shadowBlur = 26;
        ctx.shadowColor = `hsla(${hue}, 100%, 60%, 0.95)`;
        ctx.strokeStyle = `hsl(${hue}, 100%, 45%)`;
        ctx.lineWidth = thickness;
        ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke();
        ctx.restore();

        // Sculpted body gradient across thickness (dark base → bright top)
        const gx1 = (w.x1 + w.x2) / 2 - nx * half;
        const gy1 = (w.y1 + w.y2) / 2 - ny * half;
        const gx2 = (w.x1 + w.x2) / 2 + nx * half;
        const gy2 = (w.y1 + w.y2) / 2 + ny * half;
        const bevel = ctx.createLinearGradient(gx1, gy1, gx2, gy2);
        bevel.addColorStop(0, `hsl(${hue}, 90%, 78%)`);
        bevel.addColorStop(0.45, `hsl(${hue}, 95%, 52%)`);
        bevel.addColorStop(1, `hsl(${hue}, 85%, 22%)`);
        ctx.strokeStyle = bevel;
        ctx.lineWidth = thickness * 0.82;
        ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke();

        // Specular top highlight (thin bright ridge offset toward light)
        ctx.strokeStyle = `hsla(${hue}, 100%, 96%, 0.9)`;
        ctx.lineWidth = Math.max(1.4, thickness * 0.18);
        ctx.beginPath();
        ctx.moveTo(w.x1 - nx * half * 0.45, w.y1 - ny * half * 0.45);
        ctx.lineTo(w.x2 - nx * half * 0.45, w.y2 - ny * half * 0.45);
        ctx.stroke();

        // Inner bright core along the centerline
        ctx.strokeStyle = `hsl(${hue}, 100%, 92%)`;
        ctx.lineWidth = Math.max(1.2, thickness * 0.14);
        ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke();

        // Chevron / dot accents along longer walls
        if (thickness >= 10 && len > 40) {
          ctx.strokeStyle = `hsla(${hue}, 100%, 96%, 0.55)`;
          ctx.lineWidth = 1.1;
          const stepD = 16;
          const chev = half * 0.5;
          for (let d = 12; d < len - 12; d += stepD) {
            const cx = w.x1 + ux * d;
            const cy = w.y1 + uy * d;
            ctx.beginPath();
            ctx.moveTo(cx - ux * 3 + nx * chev, cy - uy * 3 + ny * chev);
            ctx.lineTo(cx + nx * (chev * 0.15), cy + ny * (chev * 0.15));
            ctx.lineTo(cx + ux * 3 + nx * chev, cy + uy * 3 + ny * chev);
            ctx.stroke();
          }
        }
      }
      ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;

      // Bumpers — sculpted 3D domes with metallic base, glowing ring, polished shell
      for (const bm of bumpersRef.current) {
        const flashing = bm.flash > 0;

        // 1. Drop shadow on playfield
        ctx.save();
        ctx.shadowBlur = 14;
        ctx.shadowColor = "rgba(0,0,0,0.75)";
        ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 5;
        ctx.fillStyle = "rgba(0,0,0,0.85)";
        ctx.beginPath(); ctx.arc(bm.x, bm.y, bm.r + 2, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        // 2. Metallic beveled base ring
        const baseR = bm.r + 4;
        const baseGrad = ctx.createRadialGradient(bm.x - 3, bm.y - 3, 2, bm.x, bm.y, baseR);
        baseGrad.addColorStop(0, "hsl(240, 15%, 45%)");
        baseGrad.addColorStop(0.6, "hsl(240, 20%, 25%)");
        baseGrad.addColorStop(1, "hsl(240, 25%, 10%)");
        ctx.fillStyle = baseGrad;
        ctx.beginPath(); ctx.arc(bm.x, bm.y, baseR, 0, Math.PI * 2); ctx.fill();

        // 3. Glowing internal light ring
        ctx.save();
        ctx.shadowBlur = flashing ? 42 : 22;
        ctx.shadowColor = flashing ? C.bumperFlash : C.bumperGlow;
        ctx.strokeStyle = flashing ? C.bumperFlash : "hsl(300, 100%, 70%)";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(bm.x, bm.y, bm.r - 1, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();

        // 4. Polished dome shell (top-lit gradient)
        const domeGrad = ctx.createRadialGradient(bm.x - bm.r * 0.4, bm.y - bm.r * 0.5, 1, bm.x, bm.y, bm.r);
        domeGrad.addColorStop(0, flashing ? "hsl(60, 100%, 96%)" : "hsl(300, 100%, 92%)");
        domeGrad.addColorStop(0.55, flashing ? "hsl(50, 100%, 75%)" : "hsl(290, 100%, 68%)");
        domeGrad.addColorStop(1, "hsl(275, 85%, 32%)");
        ctx.fillStyle = domeGrad;
        ctx.beginPath(); ctx.arc(bm.x, bm.y, bm.r - 3, 0, Math.PI * 2); ctx.fill();

        // 5. Specular highlight (glossy top-left)
        const spec = ctx.createRadialGradient(
          bm.x - bm.r * 0.4, bm.y - bm.r * 0.5, 0.5,
          bm.x - bm.r * 0.3, bm.y - bm.r * 0.35, bm.r * 0.55
        );
        spec.addColorStop(0, "rgba(255,255,255,0.95)");
        spec.addColorStop(0.5, "rgba(255,255,255,0.25)");
        spec.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = spec;
        ctx.beginPath(); ctx.arc(bm.x - bm.r * 0.3, bm.y - bm.r * 0.35, bm.r * 0.55, 0, Math.PI * 2); ctx.fill();

        // 6. Thin rim highlight around dome edge
        ctx.strokeStyle = "hsla(0,0%,100%,0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(bm.x, bm.y, bm.r - 3, 0, Math.PI * 2); ctx.stroke();
      }

      // --- one-way anti-drain gate: 3 yellow shutters, 45° angled, high in the lane ---
      {
        const open = gateOpenRef.current > 0;
        const swing = open ? 1 : 0;
        const gdx = GATE_BX - GATE_AX, gdy = GATE_BY - GATE_AY;
        const glen = Math.hypot(gdx, gdy);
        const gang = Math.atan2(gdy, gdx);
        const bars = 3;
        ctx.save();
        ctx.translate(GATE_AX, GATE_AY);
        ctx.rotate(gang);
        ctx.shadowColor = "hsla(50, 100%, 60%, 0.9)";
        ctx.shadowBlur = open ? 8 : 22;
        const seg = (glen - 6) / bars;
        for (let i = 0; i < bars; i++) {
          const bx = 3 + seg * i;
          const bw = seg - 3;
          ctx.save();
          ctx.translate(bx + bw / 2, 0);
          ctx.rotate(swing * -1.15);
          const grad = ctx.createLinearGradient(0, -GATE_HALF, 0, GATE_HALF);
          grad.addColorStop(0, "hsl(52, 100%, 82%)");
          grad.addColorStop(0.45, "hsl(48, 100%, 55%)");
          grad.addColorStop(1, "hsl(42, 90%, 32%)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.roundRect(-bw / 2, -GATE_HALF, bw, GATE_HALF * 2, 3);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = "hsla(0,0%,100%,0.55)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(-bw / 2 + 2, -GATE_HALF + 1.5);
          ctx.lineTo(bw / 2 - 2, -GATE_HALF + 1.5);
          ctx.stroke();
          ctx.restore();
        }
        // pivot studs at both ends of the angled gate
        ctx.shadowBlur = 0;
        ctx.fillStyle = "hsl(50, 100%, 85%)";
        for (const px of [3, glen - 3]) {
          ctx.beginPath(); ctx.arc(px, 0, 2.8, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }


      // --- Central sculpted triangular obstacle (rounded corners, curved edges) ---
      {
        const tracePath = (inset: number) => {
          ctx.beginPath();
          for (let i = 0; i < 3; i++) {
            const [ax, ay] = TRI_PTS[i];
            const [bx, by] = TRI_PTS[(i + 1) % 3];
            const shrink = (x: number, y: number) => {
              const vx = x - TRI_CX, vy = y - TRI_CY;
              const l = Math.hypot(vx, vy) || 1;
              return [x - (vx / l) * inset, y - (vy / l) * inset] as [number, number];
            };
            const [sax, say] = shrink(ax, ay);
            const [sbx, sby] = shrink(bx, by);
            const mx = (ax + bx) / 2, my = (ay + by) / 2;
            const ox = mx - TRI_CX, oy = my - TRI_CY;
            const ol = Math.hypot(ox, oy) || 1;
            const cpx = mx + (ox / ol) * (TRI_BULGE * 2 - inset);
            const cpy = my + (oy / ol) * (TRI_BULGE * 2 - inset);
            if (i === 0) ctx.moveTo(sax, say);
            else ctx.lineTo(sax, say);
            ctx.quadraticCurveTo(cpx, cpy, sbx, sby);
          }
          ctx.closePath();
        };

        // drop shadow / volume base
        ctx.save();
        ctx.shadowBlur = 18;
        ctx.shadowColor = "rgba(0,0,0,0.9)";
        ctx.shadowOffsetX = 4; ctx.shadowOffsetY = 6;
        ctx.fillStyle = "rgba(4,2,14,0.95)";
        ctx.lineJoin = "round";
        ctx.lineWidth = TRI_EDGE_HALF * 2;
        tracePath(-TRI_EDGE_HALF);
        ctx.strokeStyle = "rgba(4,2,14,0.95)";
        ctx.stroke();
        ctx.fill();
        ctx.restore();

        // neon glow halo
        ctx.save();
        ctx.shadowBlur = 30;
        ctx.shadowColor = "hsla(300, 100%, 62%, 0.9)";
        ctx.lineJoin = "round";
        ctx.lineWidth = TRI_EDGE_HALF * 2;
        ctx.strokeStyle = "hsla(300, 100%, 55%, 0.9)";
        tracePath(0);
        ctx.stroke();
        ctx.restore();

        // sculpted body: cyan → magenta gradient with volumetric shading
        const g = ctx.createLinearGradient(TRI_APEX_X - TRI_HALF_W, TRI_APEX_Y, TRI_APEX_X + TRI_HALF_W, TRI_BASE_Y);
        g.addColorStop(0, "hsl(190, 100%, 62%)");
        g.addColorStop(0.5, "hsl(255, 95%, 58%)");
        g.addColorStop(1, "hsl(320, 100%, 58%)");
        ctx.save();
        ctx.lineJoin = "round";
        tracePath(0);
        ctx.fillStyle = g;
        ctx.fill();
        // inner depth shading (darker toward the base)
        const shade = ctx.createLinearGradient(0, TRI_APEX_Y, 0, TRI_BASE_Y + 6);
        shade.addColorStop(0, "hsla(0,0%,100%,0.28)");
        shade.addColorStop(0.55, "hsla(0,0%,0%,0)");
        shade.addColorStop(1, "hsla(255,60%,6%,0.55)");
        ctx.fillStyle = shade;
        ctx.fill();
        // beveled bright rim
        ctx.lineWidth = 3;
        ctx.strokeStyle = "hsla(0,0%,100%,0.75)";
        tracePath(2);
        ctx.stroke();
        // specular highlight near the apex
        ctx.beginPath();
        ctx.ellipse(TRI_APEX_X - 8, TRI_APEX_Y + 26, 12, 20, -0.35, 0, Math.PI * 2);
        const spec = ctx.createRadialGradient(TRI_APEX_X - 8, TRI_APEX_Y + 26, 0, TRI_APEX_X - 8, TRI_APEX_Y + 26, 22);
        spec.addColorStop(0, "hsla(0,0%,100%,0.55)");
        spec.addColorStop(1, "hsla(0,0%,100%,0)");
        ctx.fillStyle = spec;
        ctx.fill();
        ctx.restore();
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

      // ball + hyper-speed motion blur trail
      const b = ballRef.current;
      if (b.alive) {
        const speed = Math.hypot(b.vx, b.vy);
        const trail = trailRef.current;
        trail.push({ x: b.x, y: b.y });
        const maxTrail = Math.round(6 + Math.min(1, speed / 1600) * 34); // longer trail the faster it flies
        while (trail.length > maxTrail) trail.shift();

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < trail.length; i++) {
          const t = i / trail.length;           // 0 = oldest
          const p = trail[i];
          const r = BALL_R * (0.25 + 0.75 * t);
          const a = 0.05 + 0.5 * t * t;
          ctx.shadowBlur = 26 * t;
          ctx.shadowColor = C.ballGlow;
          const tg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          tg.addColorStop(0, `hsla(320, 100%, 82%, ${a})`);
          tg.addColorStop(1, "hsla(320, 100%, 55%, 0)");
          ctx.fillStyle = tg;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();

        ctx.shadowBlur = 20 + Math.min(1, speed / 1600) * 30;
        ctx.shadowColor = C.ballGlow;
        const bg = ctx.createRadialGradient(b.x - 3, b.y - 3, 1, b.x, b.y, BALL_R);
        bg.addColorStop(0, "hsl(60, 100%, 90%)");
        bg.addColorStop(1, C.ball);
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        trailRef.current.length = 0;
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
