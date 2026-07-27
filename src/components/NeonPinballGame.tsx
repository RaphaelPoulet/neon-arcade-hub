import { useRef, useEffect, useState, useCallback } from "react";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import GameOverLeaderboard from "@/components/GameOverLeaderboard";

// ============================================================
// NEON PINBALL — Phase 1: physics, table & flippers
// ============================================================

type GameState = "idle" | "ready" | "playing" | "gameover";
type ControlScheme = "arrows" | "qwerty" | "azerty";

const WIDTH = 500;
const HEIGHT = 800;

// --- Physics constants (Classic arcade / bouncy) ---
const GRAVITY = 1400;          // px / s²
const RESTITUTION = 0.75;      // wall bounciness
const FLIPPER_RESTITUTION = 0.55;
const FRICTION = 0.999;        // per-frame velocity damp
const MAX_SPEED = 2400;        // px / s clamp to avoid tunneling
const SUBSTEPS = 6;            // physics sub-steps per frame

// --- Ball ---
const BALL_R = 11;

// --- Launcher ---
const LANE_X = WIDTH - 34;     // right-side launcher lane center
const LANE_W = 28;
const LANE_TOP = 120;
const PLUNGER_MAX = 1.0;       // 0..1 charge
const PLUNGER_POWER = 1500;    // impulse (upward) per charge unit

// --- Flippers ---
const FLIPPER_LEN = 70;
const FLIPPER_W = 12;
const PIVOT_Y = 720;
const PIVOT_L_X = 175;
const PIVOT_R_X = 325;
const REST_ANGLE = (25 * Math.PI) / 180;   // from horizontal, downward
const ACTIVE_ANGLE = (30 * Math.PI) / 180; // upward from horizontal
const FLIPPER_UP_SPEED = 26;   // rad / s
const FLIPPER_DOWN_SPEED = 14; // rad / s

// --- Table geometry (line walls) ---
// left flipper: at rest arm points from pivot down-right
// right flipper: arm points down-left
// drain gap between flipper tips.
interface Wall { x1: number; y1: number; x2: number; y2: number; }

const WALLS: Wall[] = [
  // outer left
  { x1: 0, y1: 0, x2: 0, y2: HEIGHT },
  // outer right (launcher wall)
  { x1: WIDTH, y1: 0, x2: WIDTH, y2: HEIGHT },
  // top arch (segments)
  { x1: 0, y1: 120, x2: 90, y2: 40 },
  { x1: 90, y1: 40, x2: WIDTH - 90, y2: 40 },
  { x1: WIDTH - 90, y1: 40, x2: WIDTH, y2: 120 },
  // launcher inner wall (divides lane from playfield) — stops above bottom to let ball into playfield
  { x1: WIDTH - LANE_W - 6, y1: 140, x2: WIDTH - LANE_W - 6, y2: HEIGHT - 160 },
  // curved rail leading from lane top into playfield (single segment)
  { x1: WIDTH - LANE_W - 6, y1: 140, x2: WIDTH - 90, y2: 80 },
  // bottom-left slope leading to left flipper
  { x1: 0, y1: HEIGHT - 120, x2: PIVOT_L_X - 30, y2: PIVOT_Y + 10 },
  // bottom-right slope leading to right flipper
  { x1: WIDTH - LANE_W - 6, y1: HEIGHT - 160, x2: PIVOT_R_X + 30, y2: PIVOT_Y + 10 },
];

// Drain zone: any ball with y > DRAIN_Y and x between flipper tips is lost
const DRAIN_Y = HEIGHT - 20;

// --- Controls ---
type Action = "leftFlip" | "rightFlip" | "plunger";
const CONTROL_MAPS: Record<ControlScheme, Record<string, Action>> = {
  arrows: {
    ArrowLeft: "leftFlip", ArrowRight: "rightFlip", " ": "plunger",
  },
  qwerty: {
    a: "leftFlip", A: "leftFlip", l: "rightFlip", L: "rightFlip", " ": "plunger",
  },
  azerty: {
    q: "leftFlip", Q: "leftFlip", m: "rightFlip", M: "rightFlip", " ": "plunger",
  },
};
const CONTROL_LABELS: Record<ControlScheme, string> = {
  arrows: "Arrows",
  qwerty: "A / L",
  azerty: "Q / M",
};
const HINT: Record<ControlScheme, string> = {
  arrows: "← left flipper  → right flipper  SPACE launch",
  qwerty: "A left flipper  L right flipper  SPACE launch",
  azerty: "Q flipper gauche  M flipper droit  ESPACE lancer",
};

// --- Colors ---
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
  plunger: "hsl(50, 100%, 60%)",
};

// ---- math helpers ----
function segClosestPoint(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return { x: x1, y: y1, t: 0 };
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return { x: x1 + t * dx, y: y1 + t * dy, t };
}

interface Ball {
  x: number; y: number; vx: number; vy: number; alive: boolean;
}

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

  // physics refs
  const ballRef = useRef<Ball>({ x: LANE_X, y: HEIGHT - 60, vx: 0, vy: 0, alive: false });
  const plungerRef = useRef(0); // 0..1 charge
  const plungerHoldRef = useRef(false);

  // flippers: angle relative to horizontal, negative = below horizontal
  // left rest = -REST_ANGLE (arm below), left active = +ACTIVE_ANGLE (arm above)
  // right flipper is mirrored: its arm extends from pivot at angle π - a
  const leftFlipRef = useRef({ angle: -REST_ANGLE, target: -REST_ANGLE, omega: 0 });
  const rightFlipRef = useRef({ angle: -REST_ANGLE, target: -REST_ANGLE, omega: 0 });

  const keysRef = useRef<Record<Action, boolean>>({
    leftFlip: false, rightFlip: false, plunger: false,
  });

  // --- Keyboard ---
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const a = CONTROL_MAPS[controlRef.current][e.key];
      if (a) {
        e.preventDefault();
        if (!keysRef.current[a]) {
          keysRef.current[a] = true;
          if (a === "leftFlip") leftFlipRef.current.target = ACTIVE_ANGLE;
          if (a === "rightFlip") rightFlipRef.current.target = ACTIVE_ANGLE;
          if (a === "plunger") plungerHoldRef.current = true;
        }
      }
      if (e.key === "Enter" && (stateRef.current === "idle" || stateRef.current === "gameover")) {
        startGame();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const a = CONTROL_MAPS[controlRef.current][e.key];
      if (a) {
        e.preventDefault();
        keysRef.current[a] = false;
        if (a === "leftFlip") leftFlipRef.current.target = -REST_ANGLE;
        if (a === "rightFlip") rightFlipRef.current.target = -REST_ANGLE;
        if (a === "plunger") {
          // release plunger — if ball is in lane, launch
          if (stateRef.current === "ready" && ballRef.current.alive) {
            const power = plungerRef.current * PLUNGER_POWER + 300;
            ballRef.current.vy = -power / 60 * 60; // upward
            ballRef.current.vy = -Math.max(600, plungerRef.current * PLUNGER_POWER + 400);
            setGameState("playing");
          }
          plungerRef.current = 0;
          plungerHoldRef.current = false;
        }
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
    ballRef.current = { x: LANE_X, y: HEIGHT - 60, vx: 0, vy: 0, alive: true };
    plungerRef.current = 0;
    setGameState("ready");
  }, []);

  const startGame = useCallback(() => {
    scoreRef.current = 0;
    ballNumRef.current = 1;
    setScore(0);
    setBallNum(1);
    resetBallToLauncher();
  }, [resetBallToLauncher]);

  const handleSchemeChange = (s: ControlScheme) => {
    setControlScheme(s);
    localStorage.setItem("arcade-control-scheme", s);
    setSettingsOpen(false);
    toast(`Controls: ${CONTROL_LABELS[s]}`, { duration: 1500, className: "font-pixel" });
  };

  // --- Loop ---
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
      // left arm points to right by default (angle 0 = horizontal right), negative angle = below
      const lx = PIVOT_L_X + Math.cos(L) * FLIPPER_LEN;
      const ly = PIVOT_Y - Math.sin(L) * FLIPPER_LEN; // canvas y inverted
      // right arm points to left: angle π - R
      const ra = Math.PI - R;
      const rx = PIVOT_R_X + Math.cos(ra) * FLIPPER_LEN;
      const ry = PIVOT_Y - Math.sin(ra) * FLIPPER_LEN;
      return { lx, ly, rx, ry };
    };

    const collideBallWithSegment = (
      b: Ball, x1: number, y1: number, x2: number, y2: number,
      restitution: number, extraVel?: { vx: number; vy: number }
    ) => {
      const cp = segClosestPoint(b.x, b.y, x1, y1, x2, y2);
      const dx = b.x - cp.x;
      const dy = b.y - cp.y;
      const dist2 = dx * dx + dy * dy;
      const r = BALL_R;
      if (dist2 > r * r) return false;
      const dist = Math.sqrt(dist2) || 0.0001;
      const nx = dx / dist;
      const ny = dy / dist;
      // push out
      const pen = r - dist;
      b.x += nx * pen;
      b.y += ny * pen;
      // relative velocity (account for moving flipper surface)
      let rvx = b.vx, rvy = b.vy;
      if (extraVel) { rvx -= extraVel.vx; rvy -= extraVel.vy; }
      const vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        const j = -(1 + restitution) * vn;
        b.vx += j * nx;
        b.vy += j * ny;
        // add surface velocity kick
        if (extraVel) {
          b.vx += extraVel.vx * 0.4;
          b.vy += extraVel.vy * 0.4;
        }
        return true;
      }
      return false;
    };

    const step = (dt: number) => {
      // Flipper angular update
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

      // Plunger charge
      if (plungerHoldRef.current && stateRef.current === "ready") {
        plungerRef.current = Math.min(PLUNGER_MAX, plungerRef.current + dt * 1.2);
      }

      if (stateRef.current !== "playing" && stateRef.current !== "ready") return;
      const b = ballRef.current;
      if (!b.alive) return;

      // ready-state: keep ball parked at bottom of lane
      if (stateRef.current === "ready") {
        b.x = LANE_X;
        b.y = HEIGHT - 60;
        b.vx = 0; b.vy = 0;
        return;
      }

      // sub-step physics
      const sdt = dt / SUBSTEPS;
      for (let s = 0; s < SUBSTEPS; s++) {
        b.vy += GRAVITY * sdt;
        b.vx *= FRICTION;
        b.vy *= FRICTION;
        // clamp
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > MAX_SPEED) { b.vx *= MAX_SPEED / sp; b.vy *= MAX_SPEED / sp; }
        b.x += b.vx * sdt;
        b.y += b.vy * sdt;

        // walls
        for (const w of WALLS) {
          if (collideBallWithSegment(b, w.x1, w.y1, w.x2, w.y2, RESTITUTION)) {
            scoreRef.current += 10;
          }
        }

        // flippers as thick segments (approx: line segment, ball radius already includes half thickness)
        const { lx, ly, rx, ry } = flipperEndpoints();
        // left flipper: surface point velocity at closest point
        {
          const cp = segClosestPoint(b.x, b.y, PIVOT_L_X, PIVOT_Y, lx, ly);
          const rX = cp.x - PIVOT_L_X;
          const rY = cp.y - PIVOT_Y;
          // omega positive means angle increasing; in screen coords, tangent = (-rY, rX) scaled by -omega (because y inverted)
          const w = leftFlipRef.current.omega;
          const vSurfX = -w * (-rY); //  = w * rY... simplified below
          const vSurfY = -w * (rX);
          if (collideBallWithSegment(b, PIVOT_L_X, PIVOT_Y, lx, ly, FLIPPER_RESTITUTION,
            { vx: w * rY, vy: -w * rX })) {
            scoreRef.current += 20;
          }
          void vSurfX; void vSurfY;
        }
        // right flipper
        {
          const w = rightFlipRef.current.omega;
          const rX = 0, rY = 0;
          void rX; void rY;
          // For right flipper, angle grows the same way (up); tangent computed identically w.r.t. its pivot
          const cp = segClosestPoint(b.x, b.y, PIVOT_R_X, PIVOT_Y, rx, ry);
          const rrX = cp.x - PIVOT_R_X;
          const rrY = cp.y - PIVOT_Y;
          // right flipper's arm angle is (π - angle) so ω acts with opposite sign on tangent
          if (collideBallWithSegment(b, PIVOT_R_X, PIVOT_Y, rx, ry, FLIPPER_RESTITUTION,
            { vx: -w * rrY, vy: w * rrX })) {
            scoreRef.current += 20;
          }
        }

        // drain
        if (b.y > DRAIN_Y) {
          b.alive = false;
          onBallLost();
          break;
        }
      }
    };

    const onBallLost = () => {
      if (ballNumRef.current >= 3) {
        // game over
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
      // bg
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      // playfield gradient
      const g = ctx.createRadialGradient(WIDTH / 2, HEIGHT * 0.4, 40, WIDTH / 2, HEIGHT * 0.5, HEIGHT * 0.8);
      g.addColorStop(0, "hsl(260, 60%, 14%)");
      g.addColorStop(1, C.playfield);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      // grid backdrop
      ctx.strokeStyle = "hsla(190, 100%, 60%, 0.06)";
      ctx.lineWidth = 1;
      for (let x = 0; x < WIDTH; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, HEIGHT); ctx.stroke();
      }
      for (let y = 0; y < HEIGHT; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WIDTH, y); ctx.stroke();
      }

      // drain zone
      ctx.fillStyle = C.drain;
      ctx.fillRect(0, DRAIN_Y, WIDTH, HEIGHT - DRAIN_Y);

      // walls
      ctx.shadowBlur = 12;
      ctx.shadowColor = C.wallGlow;
      ctx.strokeStyle = C.wall;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      for (const w of WALLS) {
        ctx.beginPath();
        ctx.moveTo(w.x1, w.y1);
        ctx.lineTo(w.x2, w.y2);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // launcher plunger indicator
      const plungerH = plungerRef.current * 100;
      ctx.fillStyle = "hsla(50, 100%, 60%, 0.9)";
      ctx.fillRect(LANE_X - 8, HEIGHT - 30 - plungerH, 16, plungerH);
      ctx.strokeStyle = "hsla(50, 100%, 70%, 0.8)";
      ctx.lineWidth = 2;
      ctx.strokeRect(LANE_X - 10, HEIGHT - 130, 20, 100);

      // flippers
      const drawFlipper = (px: number, py: number, angle: number, mirror: boolean) => {
        const a = mirror ? Math.PI - angle : angle;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(-a); // canvas y flipped
        ctx.shadowBlur = 16;
        ctx.shadowColor = C.flipperGlow;
        ctx.fillStyle = C.flipper;
        // draw as rounded rectangle from pivot outward
        const r = FLIPPER_W / 2;
        ctx.beginPath();
        ctx.arc(0, 0, r, Math.PI / 2, -Math.PI / 2, false);
        ctx.lineTo(FLIPPER_LEN, -r * 0.55);
        ctx.arc(FLIPPER_LEN, 0, r * 0.55, -Math.PI / 2, Math.PI / 2, false);
        ctx.lineTo(0, r);
        ctx.closePath();
        ctx.fill();
        // pivot dot
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
      {/* HUD */}
      <div className="flex items-center justify-between w-full">
        <div className="glass rounded-lg px-3 py-2">
          <span className="text-[9px] text-muted-foreground block">SCORE</span>
          <span className="font-pixel text-sm text-primary neon-text-cyan">
            {score.toLocaleString()}
          </span>
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
          <span className="font-pixel text-sm text-secondary neon-text-pink">
            {highScore.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Canvas */}
      <div
        className="relative rounded-lg overflow-hidden neon-glow-cyan"
        style={{ width: "100%", maxWidth: WIDTH, aspectRatio: `${WIDTH} / ${HEIGHT}` }}
      >
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="block w-full h-full"
        />

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
            HOLD SPACE · RELEASE TO LAUNCH
          </div>
        )}

        {gameState === "gameover" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center glass overflow-y-auto py-4">
            <h2 className="font-pixel text-sm text-secondary neon-text-pink mb-2">GAME OVER</h2>
            <p className="font-pixel text-xs text-primary neon-text-cyan mb-3">
              {score.toLocaleString()}
            </p>
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
