import { useRef, useEffect, useState, useCallback } from "react";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import GameOverLeaderboard from "@/components/GameOverLeaderboard";

// ============================================================
// SUPER KART RACER — pseudo-3D (Mode-7 style) arcade racer
// ============================================================

type GameState = "idle" | "playing" | "finished";
type ControlScheme = "arrows" | "qwerty" | "azerty";

const WIDTH = 480;
const HEIGHT = 320;

// --- Projection constants ---
const CAMERA_HEIGHT = 1000;
const CAMERA_DEPTH = 0.84;          // 1 / tan(fov/2)  ~ 50° FOV
const DRAW_DISTANCE = 220;          // segments rendered ahead
const SEGMENT_LENGTH = 200;         // world units per segment
const ROAD_WIDTH = 2000;
const LANES = 3;
const FOG_DENSITY = 5;

// --- Physics ---
const MAX_SPEED = SEGMENT_LENGTH * 60; // world units / sec
const ACCEL = MAX_SPEED / 4;
const BRAKE = -MAX_SPEED;
const DECEL = -MAX_SPEED / 5;
const OFFROAD_DECEL = -MAX_SPEED / 1.8;
const OFFROAD_LIMIT = MAX_SPEED / 3;
const CENTRIFUGAL = 0.32;
const STEER = 2.2;
const DRIFT_BOOST_MULT = 1.35;
const DRIFT_BOOST_TIME = 1.0;
const LAPS_TOTAL = 3;

// --- Control maps ---
type Action = "left" | "right" | "accel" | "brake" | "drift";
const CONTROL_MAPS: Record<ControlScheme, Record<string, Action>> = {
  arrows: {
    ArrowLeft: "left", ArrowRight: "right", ArrowUp: "accel", ArrowDown: "brake",
    Shift: "drift", " ": "drift",
  },
  qwerty: {
    a: "left", A: "left", d: "right", D: "right", w: "accel", W: "accel", s: "brake", S: "brake",
    Shift: "drift", " ": "drift",
  },
  azerty: {
    q: "left", Q: "left", d: "right", D: "right", z: "accel", Z: "accel", s: "brake", S: "brake",
    Shift: "drift", " ": "drift",
  },
};

const CONTROL_LABELS: Record<ControlScheme, string> = {
  arrows: "Arrows",
  qwerty: "WASD",
  azerty: "ZQSD",
};

const HINT: Record<ControlScheme, string> = {
  arrows: "↑ accelerate  ↓ brake  ← → steer  SPACE drift",
  qwerty: "W accelerate  S brake  A D steer  SPACE drift",
  azerty: "Z accelerer  S freiner  Q D diriger  ESPACE drift",
};

// --- Track builder ---
interface Segment {
  index: number;
  p1z: number;
  p2z: number;
  curve: number;
  y: number;
  color: "light" | "dark";
}

function easeInOut(a: number, b: number, pct: number) {
  return a + (b - a) * ((-Math.cos(pct * Math.PI) / 2) + 0.5);
}

function buildTrack(): Segment[] {
  const segs: Segment[] = [];
  const add = (n: number, curve: number, yStart: number, yEnd: number) => {
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const c = easeInOut(0, curve, t < 0.5 ? t * 2 : 1) *
                easeInOut(1, 0, t < 0.5 ? 0 : (t - 0.5) * 2);
      const y = easeInOut(yStart, yEnd, t);
      const idx = segs.length;
      segs.push({
        index: idx,
        p1z: idx * SEGMENT_LENGTH,
        p2z: (idx + 1) * SEGMENT_LENGTH,
        curve: c,
        y,
        color: Math.floor(idx / 4) % 2 === 0 ? "light" : "dark",
      });
    }
  };
  // straight, right curve, hill up, left curve, downhill, sharp right, straight
  add(50, 0, 0, 0);
  add(60, 2.2, 0, 0);
  add(40, 0, 0, 1200);
  add(60, -2.5, 1200, 800);
  add(50, 0, 800, 0);
  add(70, 3.5, 0, 0);
  add(40, 0, 0, 400);
  add(60, -1.8, 400, 400);
  add(50, 0, 400, 0);
  add(30, 0, 0, 0);
  return segs;
}

const TRACK = buildTrack();
const TRACK_LENGTH = TRACK.length * SEGMENT_LENGTH;

// --- Colors ---
const COLORS = {
  skyTop: "hsl(280, 60%, 12%)",
  skyBot: "hsl(320, 70%, 20%)",
  sun: "hsl(330, 100%, 65%)",
  mountain: "hsl(260, 40%, 15%)",
  roadLight: "hsl(230, 15%, 22%)",
  roadDark: "hsl(230, 15%, 18%)",
  grassLight: "hsl(180, 40%, 12%)",
  grassDark: "hsl(180, 40%, 10%)",
  rumbleLight: "hsl(0, 90%, 60%)",
  rumbleDark: "hsl(0, 0%, 98%)",
  lane: "hsl(0, 0%, 90%)",
  fog: "hsl(280, 60%, 12%)",
};

function project(seg: any, camX: number, camY: number, camZ: number, camDepth: number) {
  const dz = (seg.p1z - camZ);
  seg.camera_x = -camX + 0;
  seg.camera_y = -camY + seg.y;
  seg.camera_z = dz;
  seg.screen_scale = camDepth / dz;
  seg.screen_x = Math.round((WIDTH / 2) + (seg.screen_scale * -camX * WIDTH / 2));
  seg.screen_y = Math.round((HEIGHT / 2) - (seg.screen_scale * (seg.y - camY) * HEIGHT / 2));
  seg.screen_w = Math.round(seg.screen_scale * ROAD_WIDTH * WIDTH / 2);
}

function drawPolygon(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}

function drawSegment(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, w1: number,
  x2: number, y2: number, w2: number,
  color: "light" | "dark",
  fog: number,
) {
  const r1 = w1 / Math.max(6, 2 * LANES);
  const r2 = w2 / Math.max(6, 2 * LANES);
  const l1 = w1 / Math.max(32, 8 * LANES);
  const l2 = w2 / Math.max(32, 8 * LANES);
  const grass = color === "light" ? COLORS.grassLight : COLORS.grassDark;
  const road = color === "light" ? COLORS.roadLight : COLORS.roadDark;
  const rumble = color === "light" ? COLORS.rumbleLight : COLORS.rumbleDark;

  // grass
  ctx.fillStyle = grass;
  ctx.fillRect(0, y2, WIDTH, y1 - y2);
  // rumble
  drawPolygon(ctx, x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2, rumble);
  drawPolygon(ctx, x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2, rumble);
  // road
  drawPolygon(ctx, x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, road);
  // lane markers
  if (color === "light") {
    for (let lane = 1; lane < LANES; lane++) {
      const lx1 = x1 - w1 + (w1 * 2 * lane) / LANES - l1 / 2;
      const lx2 = x2 - w2 + (w2 * 2 * lane) / LANES - l2 / 2;
      drawPolygon(ctx, lx1, y1, lx1 + l1, y1, lx2 + l2, y2, lx2, y2, COLORS.lane);
    }
  }
  // fog overlay
  if (fog > 0) {
    ctx.fillStyle = COLORS.fog;
    ctx.globalAlpha = fog;
    ctx.fillRect(0, y2, WIDTH, y1 - y2);
    ctx.globalAlpha = 1;
  }
}

function fogFactor(distance: number, density: number) {
  return 1 - (1 / Math.exp(distance * distance * density));
}

// ============================================================
// Component
// ============================================================
const SuperKartGame = () => {
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

  // HUD state
  const [lap, setLap] = useState(1);
  const [speedMph, setSpeedMph] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [bestTime, setBestTime] = useState<number>(() => {
    const s = localStorage.getItem("super-kart-best");
    return s ? parseFloat(s) : 0;
  });
  const [finalTime, setFinalTime] = useState(0);
  const [newRecord, setNewRecord] = useState(false);

  // Game refs
  const positionRef = useRef(0);        // z along track
  const playerXRef = useRef(0);         // -1..1 (normalised)
  const speedRef = useRef(0);
  const lapRef = useRef(1);
  const lastPosRef = useRef(0);
  const startTimeRef = useRef(0);
  const boostRef = useRef(0);
  const driftingRef = useRef(false);
  const driftDirRef = useRef(0);        // -1 / 1 during drift, 0 else
  const driftChargeRef = useRef(0);

  const keysRef = useRef<Record<Action, boolean>>({
    left: false, right: false, accel: false, brake: false, drift: false,
  });

  // Keyboard
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const a = CONTROL_MAPS[controlRef.current][e.key];
      if (a) { e.preventDefault(); keysRef.current[a] = true; }
      if (e.key === "Enter" && (stateRef.current === "idle" || stateRef.current === "finished")) {
        startGame();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const a = CONTROL_MAPS[controlRef.current][e.key];
      if (a) {
        e.preventDefault();
        keysRef.current[a] = false;
        if (a === "drift" && driftingRef.current) {
          // release drift → mini boost if charged
          if (driftChargeRef.current > 0.4) {
            boostRef.current = DRIFT_BOOST_TIME;
          }
          driftingRef.current = false;
          driftDirRef.current = 0;
          driftChargeRef.current = 0;
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

  const startGame = useCallback(() => {
    positionRef.current = 0;
    lastPosRef.current = 0;
    playerXRef.current = 0;
    speedRef.current = 0;
    lapRef.current = 1;
    boostRef.current = 0;
    driftingRef.current = false;
    driftDirRef.current = 0;
    driftChargeRef.current = 0;
    startTimeRef.current = performance.now();
    setLap(1); setElapsed(0); setNewRecord(false);
    setGameState("playing");
  }, []);

  const handleSchemeChange = (s: ControlScheme) => {
    setControlScheme(s);
    localStorage.setItem("arcade-control-scheme", s);
    setSettingsOpen(false);
    toast(`Controls: ${CONTROL_LABELS[s]}`, { duration: 1500, className: "font-pixel" });
  };

  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    let last = performance.now();

    const frame = (now: number) => {
      rafRef.current = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (stateRef.current === "playing") update(dt, now);
      render(ctx);
    };

    const update = (dt: number, now: number) => {
      const keys = keysRef.current;

      // --- speed
      let accel = DECEL;
      if (keys.accel) accel = ACCEL;
      if (keys.brake) accel = BRAKE;
      speedRef.current = Math.max(0, Math.min(MAX_SPEED, speedRef.current + accel * dt));

      // boost
      if (boostRef.current > 0) {
        boostRef.current -= dt;
        speedRef.current = Math.min(MAX_SPEED * DRIFT_BOOST_MULT, speedRef.current + ACCEL * dt);
      }

      // --- position along track
      positionRef.current += speedRef.current * dt;
      // lap detection
      if (positionRef.current >= TRACK_LENGTH) {
        positionRef.current -= TRACK_LENGTH;
        lastPosRef.current -= TRACK_LENGTH;
        lapRef.current += 1;
        setLap(lapRef.current);
        if (lapRef.current > LAPS_TOTAL) {
          finishRace(now);
          return;
        }
      }

      // --- steering
      const speedPct = speedRef.current / MAX_SPEED;
      const dx = STEER * speedPct * dt;
      const turning = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);

      // drift start: hold drift + turn while moving
      if (keys.drift && !driftingRef.current && turning !== 0 && speedRef.current > MAX_SPEED * 0.3) {
        driftingRef.current = true;
        driftDirRef.current = turning;
      }
      if (driftingRef.current) {
        driftChargeRef.current += dt;
        // sharper turn during drift
        playerXRef.current += driftDirRef.current * dx * 1.6;
      } else {
        playerXRef.current += turning * dx;
      }

      // centrifugal on curves
      const seg = TRACK[Math.floor(positionRef.current / SEGMENT_LENGTH) % TRACK.length];
      playerXRef.current -= (dx * speedPct * seg.curve * CENTRIFUGAL);

      // off-road
      if (Math.abs(playerXRef.current) > 1) {
        speedRef.current = Math.min(speedRef.current, OFFROAD_LIMIT);
        speedRef.current = Math.max(0, speedRef.current + OFFROAD_DECEL * dt);
      }
      // hard bounds (wall)
      if (playerXRef.current > 1.9) playerXRef.current = 1.9;
      if (playerXRef.current < -1.9) playerXRef.current = -1.9;

      // HUD
      setSpeedMph(Math.round((speedRef.current / MAX_SPEED) * 200));
      setElapsed((now - startTimeRef.current) / 1000);
    };

    const finishRace = (now: number) => {
      const t = (now - startTimeRef.current) / 1000;
      setFinalTime(t);
      if (bestTime === 0 || t < bestTime) {
        setBestTime(t);
        localStorage.setItem("super-kart-best", String(t));
        setNewRecord(true);
      }
      setGameState("finished");
    };

    const render = (ctx: CanvasRenderingContext2D) => {
      // ---- Sky
      const grad = ctx.createLinearGradient(0, 0, 0, HEIGHT * 0.65);
      grad.addColorStop(0, COLORS.skyTop);
      grad.addColorStop(1, COLORS.skyBot);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      // ---- Sun
      const sunX = WIDTH / 2 + 90;
      const sunY = HEIGHT * 0.42;
      const sunR = 55;
      const sunGrad = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, sunR);
      sunGrad.addColorStop(0, "hsl(50, 100%, 75%)");
      sunGrad.addColorStop(0.5, COLORS.sun);
      sunGrad.addColorStop(1, "hsla(330, 100%, 65%, 0)");
      ctx.fillStyle = sunGrad;
      ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2); ctx.fill();
      // scanlines on sun
      ctx.fillStyle = COLORS.skyBot;
      for (let i = 0; i < 6; i++) {
        const yy = sunY + 8 + i * 8;
        ctx.fillRect(sunX - sunR, yy, sunR * 2, 2 + i * 0.5);
      }

      // ---- Mountains
      ctx.fillStyle = COLORS.mountain;
      ctx.beginPath();
      ctx.moveTo(0, HEIGHT * 0.55);
      for (let i = 0; i <= 10; i++) {
        const px = (WIDTH * i) / 10;
        const py = HEIGHT * 0.55 - Math.abs(Math.sin(i * 1.7)) * 40;
        ctx.lineTo(px, py);
      }
      ctx.lineTo(WIDTH, HEIGHT * 0.65);
      ctx.lineTo(0, HEIGHT * 0.65);
      ctx.closePath();
      ctx.fill();

      // ---- Road segments
      const baseIdx = Math.floor(positionRef.current / SEGMENT_LENGTH);
      const baseSeg = TRACK[baseIdx % TRACK.length];
      const camX = playerXRef.current * ROAD_WIDTH;
      const camZ = positionRef.current;
      const camY = CAMERA_HEIGHT + baseSeg.y;

      let maxY = HEIGHT;
      let x = 0, dx = 0;

      for (let n = 0; n < DRAW_DISTANCE; n++) {
        const segIdx = (baseIdx + n) % TRACK.length;
        const seg: any = { ...TRACK[segIdx] };
        seg.looped = segIdx < baseIdx;
        seg.p1z = (baseIdx + n) * SEGMENT_LENGTH;
        seg.p2z = (baseIdx + n + 1) * SEGMENT_LENGTH;
        seg.fog = fogFactor(n / DRAW_DISTANCE, FOG_DENSITY);

        // p1 (near)
        const dz1 = seg.p1z - camZ;
        const scale1 = CAMERA_DEPTH / Math.max(1, dz1);
        const sx1 = Math.round((WIDTH / 2) + (scale1 * (-camX + x) * WIDTH / 2));
        const sy1 = Math.round((HEIGHT / 2) - (scale1 * (TRACK[segIdx].y - camY) * HEIGHT / 2));
        const sw1 = Math.round(scale1 * ROAD_WIDTH * WIDTH / 2);

        // p2 (far)
        const dz2 = seg.p2z - camZ;
        const scale2 = CAMERA_DEPTH / Math.max(1, dz2);
        const nextY = TRACK[(segIdx + 1) % TRACK.length].y;
        const sx2 = Math.round((WIDTH / 2) + (scale2 * (-camX + x + dx) * WIDTH / 2));
        const sy2 = Math.round((HEIGHT / 2) - (scale2 * (nextY - camY) * HEIGHT / 2));
        const sw2 = Math.round(scale2 * ROAD_WIDTH * WIDTH / 2);

        x += dx;
        dx += TRACK[segIdx].curve;

        if (dz1 <= CAMERA_DEPTH || sy2 >= maxY || sy2 >= sy1) continue;

        drawSegment(ctx, sx1, sy1, sw1, sx2, sy2, sw2, TRACK[segIdx].color, seg.fog);
        maxY = sy2;
      }

      // ---- Kart sprite (simple pseudo-3D)
      drawKart(ctx);

      // ---- Speed lines
      if (speedRef.current > MAX_SPEED * 0.6) {
        ctx.strokeStyle = "hsla(190, 100%, 60%, 0.5)";
        ctx.lineWidth = 1;
        for (let i = 0; i < 6; i++) {
          const yy = HEIGHT * 0.6 + Math.random() * HEIGHT * 0.35;
          ctx.beginPath();
          ctx.moveTo(0, yy); ctx.lineTo(30, yy);
          ctx.moveTo(WIDTH - 30, yy); ctx.lineTo(WIDTH, yy);
          ctx.stroke();
        }
      }
    };

    const drawKart = (ctx: CanvasRenderingContext2D) => {
      const cx = WIDTH / 2;
      const cy = HEIGHT - 46;
      const tilt = driftingRef.current ? driftDirRef.current * 6 : 0;
      // shadow
      ctx.fillStyle = "hsla(0,0%,0%,0.5)";
      ctx.beginPath(); ctx.ellipse(cx, cy + 22, 34, 6, 0, 0, Math.PI * 2); ctx.fill();

      ctx.save();
      ctx.translate(cx + tilt * 0.8, cy);
      ctx.rotate((tilt * Math.PI) / 180);
      // body
      ctx.fillStyle = "hsl(0, 90%, 55%)";
      ctx.fillRect(-24, -6, 48, 20);
      ctx.fillStyle = "hsl(0, 90%, 45%)";
      ctx.fillRect(-24, 10, 48, 6);
      // cockpit
      ctx.fillStyle = "hsl(230, 25%, 15%)";
      ctx.fillRect(-10, -14, 20, 10);
      // wheels
      ctx.fillStyle = "hsl(0, 0%, 8%)";
      ctx.fillRect(-30, -2, 6, 14);
      ctx.fillRect(24, -2, 6, 14);
      ctx.fillRect(-28, 14, 6, 10);
      ctx.fillRect(22, 14, 6, 10);
      // headlight
      ctx.fillStyle = "hsl(50, 100%, 70%)";
      ctx.fillRect(-6, -16, 12, 3);
      ctx.restore();

      // drift sparks
      if (driftingRef.current) {
        const color = driftChargeRef.current > 0.4 ? "hsl(190,100%,60%)" : "hsl(40,100%,60%)";
        ctx.fillStyle = color;
        for (let i = 0; i < 6; i++) {
          const sx = cx - driftDirRef.current * 30 + (Math.random() - 0.5) * 20;
          const sy = cy + 18 + Math.random() * 6;
          ctx.fillRect(sx, sy, 2 + Math.random() * 2, 2);
        }
      }
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [bestTime]);

  const fmt = (t: number) => {
    if (!t) return "--:--";
    const m = Math.floor(t / 60);
    const s = (t - m * 60).toFixed(2);
    return `${String(m).padStart(2, "0")}:${s.padStart(5, "0")}`;
  };

  const schemes: ControlScheme[] = ["arrows", "qwerty", "azerty"];
  // leaderboard score: lower time = higher score
  const scoreFromTime = (t: number) => Math.max(0, Math.round(999999 - t * 100));

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-[520px] mx-auto px-4">
      {/* HUD */}
      <div className="flex items-center justify-between w-full">
        <div className="glass rounded-lg px-3 py-2">
          <span className="text-[9px] text-muted-foreground block">LAP</span>
          <span className="font-pixel text-sm text-primary neon-text-cyan">
            {Math.min(lap, LAPS_TOTAL)}/{LAPS_TOTAL}
          </span>
        </div>
        <div className="glass rounded-lg px-3 py-2 text-center">
          <span className="text-[9px] text-muted-foreground block">TIME</span>
          <span className="font-pixel text-sm text-neon-yellow">{fmt(elapsed)}</span>
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
                      {s === "arrows" ? "↑ ↓ ← →" : s === "qwerty" ? "W A S D" : "Z Q S D"}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="glass rounded-lg px-3 py-2 text-right">
          <span className="text-[9px] text-muted-foreground block">SPEED</span>
          <span className="font-pixel text-sm text-secondary neon-text-pink">{speedMph}</span>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative rounded-lg overflow-hidden neon-glow-cyan" style={{ width: WIDTH, height: HEIGHT }}>
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="block"
          style={{ imageRendering: "pixelated" }}
        />

        {gameState === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center glass">
            <h2 className="font-pixel text-sm text-secondary neon-text-pink mb-2">SUPER KART RACER</h2>
            <p className="text-[10px] text-muted-foreground mb-1">3 LAPS · TIME TRIAL</p>
            <p className="text-[10px] text-muted-foreground mb-4 text-center px-4">{HINT[controlScheme]}</p>
            <button
              onClick={startGame}
              className="bg-secondary text-secondary-foreground font-pixel text-[10px] px-6 py-3 rounded-lg neon-glow-pink hover:scale-105 active:scale-95 transition-transform"
            >
              INSERT COIN
            </button>
            {bestTime > 0 && (
              <p className="font-pixel text-[9px] text-neon-yellow mt-4">BEST {fmt(bestTime)}</p>
            )}
          </div>
        )}

        {gameState === "finished" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center glass overflow-y-auto py-4">
            <h2 className="font-pixel text-sm text-secondary neon-text-pink mb-2">FINISH!</h2>
            {newRecord && (
              <p className="font-pixel text-[10px] text-neon-yellow animate-pulse-neon mb-1">🏆 NEW RECORD!</p>
            )}
            <p className="font-pixel text-xs text-primary neon-text-cyan mb-3">{fmt(finalTime)}</p>
            <GameOverLeaderboard gameId="racer" score={scoreFromTime(finalTime)} />
            <button
              onClick={startGame}
              className="bg-secondary text-secondary-foreground font-pixel text-[10px] px-6 py-3 rounded-lg neon-glow-pink hover:scale-105 active:scale-95 transition-transform mt-3"
            >
              INSERT COIN TO REPLAY
            </button>
          </div>
        )}
      </div>

      {gameState === "playing" && boostRef.current > 0 && (
        <div className="glass rounded-md px-3 py-1 font-pixel text-[10px] text-neon-yellow animate-pulse-neon">
          BOOST!
        </div>
      )}
    </div>
  );
};

export default SuperKartGame;
