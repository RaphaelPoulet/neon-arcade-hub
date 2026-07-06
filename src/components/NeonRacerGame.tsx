import { useRef, useEffect, useState, useCallback } from "react";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import GameOverLeaderboard from "@/components/GameOverLeaderboard";
import { Progress } from "@/components/ui/progress";

/* ═══════════════════════════════════════════════════════════
   SUPER KART RACER — SNES Mode-7 style arcade circuit racer
   ═══════════════════════════════════════════════════════════ */

type ControlScheme = "arrows" | "qwerty" | "azerty";
type Phase = "idle" | "playing" | "finished" | "gameover";

const CONTROL_LABELS: Record<ControlScheme, string> = {
  arrows: "Arrows",
  qwerty: "WASD",
  azerty: "ZQSD",
};

const HINTS: Record<ControlScheme, string> = {
  arrows: "← → steer · ↑ accel · ↓ brake · Space drift",
  qwerty: "A/D steer · W accel · S brake · Space drift",
  azerty: "Q/D steer · Z accel · S brake · Space drift",
};

/* ── canvas ── */
const W = 640;
const H = 480;

/* ── mode-7 style projection ── */
const SEG_LEN = 200;
const DRAW_DIST = 160;
const ROAD_W = 2200;
const LANES = 3;
const FOV_DEG = 100;
const CAM_HEIGHT = 1500;
const FOCAL = 1 / Math.tan((FOV_DEG / 2) * Math.PI / 180);

/* ── arcade physics (fun > realism) ── */
const MAX_SPEED = SEG_LEN * 55;
const ACCEL = MAX_SPEED / 80;
const BRAKE = MAX_SPEED / 40;
const ENGINE_BRAKE = MAX_SPEED / 220;
const STEER = 3.5;              // tight arcade turning
const CENTRIFUGAL = 0.35;
const OFF_ROAD_MULT = 0.35;     // grass slowdown
const OFF_ROAD_BOUND = 1.0;

/* ── drift ── */
const DRIFT_MIN_SPEED = 0.4;
const DRIFT_SPEED_MULT = 0.95;
const DRIFT_LATERAL = 2.2;
const MINI_BOOST_MULT = 1.5;
const MINI_BOOST_FRAMES = 55;

/* ── gameplay ── */
const INITIAL_TIME = 60;
const CHECKPOINT_BONUS = 15;
const TOTAL_LAPS = 3;
const SHAKE = 4;

/* ── palette ── */
const C_SKY_TOP = "#0a0020";
const C_SKY_BOT = "#240046";
const C_SUN = "#FF007F";
const C_SUN_GLOW = "#ff00ff80";
const C_MTN = "#1a0035";
const C_MTN_HI = "#2d0060";
const C_GRASS_A = "#0a0a2e";
const C_GRASS_B = "#0d0d3a";
const C_ROAD_A = "#1a1a3e";
const C_ROAD_B = "#222255";
const C_RUMBLE_A = "#FF007F";
const C_RUMBLE_B = "#00FFFF";
const C_LANE = "#ffffff30";
const C_FINISH_W = "#ffffff";
const C_FINISH_B = "#111111";

/* ── track definition ── */
interface Zone { length: number; curve: number; hill: number; label?: string; }

const CIRCUIT: Zone[] = [
  { length: 180, curve: 0,    hill: 0,    label: "START" },
  { length: 120, curve: 2.5,  hill: 0,    label: "EASY LEFT" },
  { length: 80,  curve: 0,    hill: 0    },
  { length: 140, curve: -3,   hill: 2500, label: "RIGHT HILL" },
  { length: 70,  curve: 0,    hill: 0    },
  { length: 100, curve: 2,    hill: 0,    label: "S-IN" },
  { length: 100, curve: -2,   hill: 0,    label: "S-OUT" },
  { length: 70,  curve: 0,    hill: 0    },
  { length: 160, curve: -2.5, hill: 3000, label: "LONG RIGHT" },
  { length: 100, curve: 0,    hill: 0,    label: "BACK STRAIGHT" },
  { length: 120, curve: 3.5,  hill: 1500, label: "HAIRPIN" },
  { length: 80,  curve: 0,    hill: 0    },
  { length: 100, curve: -1.5, hill: 0    },
  { length: 60,  curve: 0,    hill: 0    },
  { length: 110, curve: 2,    hill: 2000, label: "UPHILL LEFT" },
  { length: 80,  curve: 0,    hill: 0    },
  { length: 100, curve: -3,   hill: 0,    label: "SHARP RIGHT" },
  { length: 220, curve: 0,    hill: 0,    label: "FINISH" },
];

interface Segment {
  z: number;
  y: number;
  curve: number;
  px: number; py: number; pw: number; pscale: number;
  clip: number;
  checkpoint?: boolean;
  finish?: boolean;
  palm?: boolean;
  palmX?: number;
}

interface FloatingText {
  x: number; y: number; text: string; life: number; max: number;
}

function buildCircuit() {
  const segs: Segment[] = [];
  const cps: number[] = [];
  const RAMP = 40;
  let i = 0;
  for (const z of CIRCUIT) {
    for (let k = 0; k < z.length; k++) {
      let c = z.curve;
      if (k < RAMP) c *= k / RAMP;
      else if (z.length - k < RAMP) c *= (z.length - k) / RAMP;

      const y = z.hill ? Math.sin((k / z.length) * Math.PI) * z.hill : 0;

      const s: Segment = {
        z: i * SEG_LEN, y, curve: c,
        px: 0, py: 0, pw: 0, pscale: 0, clip: H,
      };
      if (i % 18 === 0 && i > 5) {
        s.palm = true;
        s.palmX = (i % 36 === 0 ? 1 : -1) * (1.2 + (i % 7) * 0.1);
      }
      segs.push(s);
      i++;
    }
  }
  const lapLen = segs.length;
  const step = Math.floor(lapLen / 4);
  for (let n = 1; n <= 3; n++) {
    const ci = n * step;
    if (ci < lapLen) { segs[ci].checkpoint = true; cps.push(ci); }
  }
  for (let f = Math.max(0, lapLen - 10); f < lapLen; f++) segs[f].finish = true;
  return { segs, lapLen, cps };
}

/* ── mode-7 style projection ── */
function project(s: Segment, camX: number, camY: number, camZ: number) {
  const dz = s.z - camZ;
  if (dz <= 0) { s.pscale = 0; return; }
  s.pscale = FOCAL / dz;
  s.px = Math.round(W / 2 + s.pscale * (0 - camX) * W / 2);
  s.py = Math.round(H / 2 - s.pscale * (s.y - camY) * H / 2);
  s.pw = Math.round(s.pscale * ROAD_W * W / 2);
}

function poly(ctx: CanvasRenderingContext2D, color: string,
  x1: number, y1: number, w1: number,
  x2: number, y2: number, w2: number) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(Math.round(x1 - w1), y1);
  ctx.lineTo(Math.round(x1 + w1), y1);
  ctx.lineTo(Math.round(x2 + w2), y2);
  ctx.lineTo(Math.round(x2 - w2), y2);
  ctx.closePath();
  ctx.fill();
}

/* ── input ── */
function readInput(keys: Set<string>, scheme: ControlScheme) {
  const left = scheme === "arrows" ? keys.has("ArrowLeft")
    : scheme === "qwerty" ? (keys.has("a") || keys.has("A"))
    : (keys.has("q") || keys.has("Q"));
  const right = scheme === "arrows" ? keys.has("ArrowRight") : (keys.has("d") || keys.has("D"));
  const accel = scheme === "arrows" ? keys.has("ArrowUp")
    : scheme === "qwerty" ? (keys.has("w") || keys.has("W"))
    : (keys.has("z") || keys.has("Z"));
  const brake = scheme === "arrows" ? keys.has("ArrowDown") : (keys.has("s") || keys.has("S"));
  const drift = keys.has(" ");
  return { left, right, accel, brake, drift };
}

/* ═══════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════ */
const NeonRacerGame = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [score, setScore] = useState(0);
  const [mph, setMph] = useState(0);
  const [timeLeft, setTimeLeft] = useState(INITIAL_TIME);
  const [lapPct, setLapPct] = useState(0);
  const [currentLap, setCurrentLap] = useState(1);
  const [bestLap, setBestLap] = useState<number | null>(null);
  const [crash, setCrash] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scheme, setScheme] = useState<ControlScheme>(() =>
    (localStorage.getItem("arcade-control-scheme") as ControlScheme) || "arrows"
  );

  const phaseRef = useRef<Phase>("idle");
  const keysRef = useRef<Set<string>>(new Set());
  const schemeRef = useRef(scheme);
  const roadRef = useRef<Segment[]>([]);
  const lapLenRef = useRef(0);
  const cpsRef = useRef<number[]>([]);
  const animRef = useRef(0);
  const lastTsRef = useRef(0);
  const floatsRef = useRef<FloatingText[]>([]);
  const lapStartRef = useRef(0);

  // game state refs
  const posRef = useRef(0);         // world Z position
  const xRef = useRef(0);           // lateral (-1..1 = on road)
  const speedRef = useRef(0);
  const timerRef = useRef(INITIAL_TIME);
  const lapRef = useRef(1);
  const bestLapRef = useRef<number | null>(null);
  const passedCPRef = useRef<Set<string>>(new Set());
  const shakeRef = useRef(0);
  const offRoadRef = useRef(false);

  // drift state
  const driftingRef = useRef(false);
  const driftDirRef = useRef(0);
  const miniBoostRef = useRef(0);

  const handleScheme = useCallback((s: ControlScheme) => {
    setScheme(s);
    schemeRef.current = s;
    localStorage.setItem("arcade-control-scheme", s);
    setSettingsOpen(false);
    toast(`Controls set to ${CONTROL_LABELS[s]}`, { duration: 2000, className: "font-pixel" });
  }, []);

  const startGame = useCallback(() => {
    const { segs, lapLen, cps } = buildCircuit();
    roadRef.current = segs;
    lapLenRef.current = lapLen;
    cpsRef.current = cps;
    posRef.current = 0;
    xRef.current = 0;
    speedRef.current = 0;
    timerRef.current = INITIAL_TIME;
    lapRef.current = 1;
    bestLapRef.current = null;
    passedCPRef.current = new Set();
    shakeRef.current = 0;
    offRoadRef.current = false;
    driftingRef.current = false;
    driftDirRef.current = 0;
    miniBoostRef.current = 0;
    floatsRef.current = [];
    lapStartRef.current = 0;

    phaseRef.current = "playing";
    setPhase("playing");
    setScore(0);
    setMph(0);
    setTimeLeft(INITIAL_TIME);
    setLapPct(0);
    setCurrentLap(1);
    setBestLap(null);
    setCrash("");
  }, []);

  // input listeners
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keysRef.current.add(e.key);
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
      if (phaseRef.current !== "playing" && (e.key === "Enter" || e.key === " ")) startGame();
    };
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [startGame]);

  // main game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const loop = (ts: number) => {
      const dt = lastTsRef.current ? Math.min((ts - lastTsRef.current) / 1000, 0.05) : 1 / 60;
      lastTsRef.current = ts;

      const road = roadRef.current;
      const lapLen = lapLenRef.current;
      const lapWorld = lapLen * SEG_LEN;

      /* ═══ UPDATE ═══ */
      if (phaseRef.current === "playing" && road.length > 0) {
        if (lapStartRef.current === 0) lapStartRef.current = ts / 1000;
        const inp = readInput(keysRef.current, schemeRef.current);

        let spd = speedRef.current;
        const boosting = miniBoostRef.current > 0;
        const isOff = Math.abs(xRef.current) > OFF_ROAD_BOUND;
        offRoadRef.current = isOff;

        let effMax = MAX_SPEED;
        if (isOff) effMax = MAX_SPEED * OFF_ROAD_MULT;
        else if (boosting) effMax = MAX_SPEED * MINI_BOOST_MULT;
        else if (driftingRef.current) effMax = MAX_SPEED * DRIFT_SPEED_MULT;

        // accel / brake / engine brake
        if (inp.accel) spd += ACCEL * dt * 60;
        else if (inp.brake) spd -= BRAKE * dt * 60;
        else spd -= ENGINE_BRAKE * dt * 60;

        if (isOff && spd > effMax) {
          spd -= MAX_SPEED / 15 * dt * 60;
          shakeRef.current = SHAKE;
        }
        spd = Math.max(0, Math.min(spd, effMax));
        speedRef.current = spd;

        // steering — tight arcade feel
        const speedRatio = spd / MAX_SPEED;
        const steerAmt = STEER * speedRatio * dt * 60;
        const steerDir = inp.left ? -1 : inp.right ? 1 : 0;
        if (inp.left) xRef.current -= steerAmt * 0.015;
        if (inp.right) xRef.current += steerAmt * 0.015;
        xRef.current = Math.max(-2.2, Math.min(2.2, xRef.current));

        // drift mechanic — hold drift button + turning while moving
        const canDrift = inp.drift && steerDir !== 0 && speedRatio > DRIFT_MIN_SPEED;
        if (canDrift) {
          if (!driftingRef.current) {
            driftingRef.current = true;
            driftDirRef.current = steerDir;
          }
          // push outward (centrifugal-like slide)
          xRef.current += driftDirRef.current * DRIFT_LATERAL * speedRatio * dt * 0.5;
        } else if (driftingRef.current) {
          // release → mini-boost
          driftingRef.current = false;
          miniBoostRef.current = MINI_BOOST_FRAMES;
          floatsRef.current.push({
            x: W / 2, y: H * 0.4, text: "MINI BOOST!", life: 45, max: 45,
          });
        }

        if (miniBoostRef.current > 0) miniBoostRef.current--;

        // forward motion
        posRef.current += spd * dt;

        // centrifugal from road curve
        const worldPos = ((posRef.current % lapWorld) + lapWorld) % lapWorld;
        const segIdx = Math.min(Math.floor(worldPos / SEG_LEN), lapLen - 1);
        if (segIdx >= 0) {
          xRef.current += road[segIdx].curve * CENTRIFUGAL * speedRatio * dt * 60;
        }

        // shake decay
        if (shakeRef.current > 0) { shakeRef.current *= 0.9; if (shakeRef.current < 0.1) shakeRef.current = 0; }

        // grass collision — extreme = game over
        if (Math.abs(xRef.current) > 2.0) {
          setCrash("OFF TRACK!");
          phaseRef.current = "gameover";
          setPhase("gameover");
          const finalScore = Math.floor(posRef.current / SEG_LEN);
          setScore(finalScore);
        }

        // timer
        timerRef.current -= dt;
        if (timerRef.current <= 0) {
          timerRef.current = 0;
          setCrash("TIME'S UP");
          phaseRef.current = "gameover";
          setPhase("gameover");
          setScore(Math.floor(posRef.current / SEG_LEN));
        }

        // checkpoints
        for (const cpIdx of cpsRef.current) {
          const key = `${lapRef.current}-${cpIdx}`;
          if (!passedCPRef.current.has(key) && segIdx >= cpIdx) {
            passedCPRef.current.add(key);
            timerRef.current += CHECKPOINT_BONUS;
            floatsRef.current.push({
              x: W / 2, y: H * 0.3, text: `CHECKPOINT +${CHECKPOINT_BONUS}s`, life: 65, max: 65,
            });
          }
        }

        // lap completion
        const completedLaps = Math.floor(posRef.current / lapWorld);
        if (completedLaps >= lapRef.current) {
          const lapTime = ts / 1000 - lapStartRef.current;
          lapStartRef.current = ts / 1000;
          if (bestLapRef.current === null || lapTime < bestLapRef.current) {
            bestLapRef.current = lapTime;
            setBestLap(lapTime);
          }
          if (completedLaps >= TOTAL_LAPS) {
            const finalScore = Math.floor(timerRef.current * 100) + Math.floor(posRef.current / SEG_LEN);
            setScore(finalScore);
            phaseRef.current = "finished";
            setPhase("finished");
          } else {
            lapRef.current = completedLaps + 1;
            setCurrentLap(lapRef.current);
            floatsRef.current.push({
              x: W / 2, y: H * 0.25, text: `LAP ${lapRef.current}/${TOTAL_LAPS}`, life: 75, max: 75,
            });
          }
        }

        // HUD state
        setMph(Math.floor(spd / MAX_SPEED * 220));
        setTimeLeft(Math.max(0, Math.ceil(timerRef.current)));
        const prog = ((posRef.current % lapWorld) / lapWorld) * 100;
        setLapPct(Math.min(100, Math.max(0, prog)));
        setScore(Math.floor(posRef.current / SEG_LEN));

        // decay floating texts
        floatsRef.current = floatsRef.current
          .map(f => ({ ...f, life: f.life - 1, y: f.y - 0.8 }))
          .filter(f => f.life > 0);
      }

      /* ═══ RENDER ═══ */
      ctx.save();
      if (shakeRef.current > 0) {
        ctx.translate(
          Math.round((Math.random() - 0.5) * shakeRef.current * 2),
          Math.round((Math.random() - 0.5) * shakeRef.current * 2)
        );
      }

      // sky
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H / 2);
      skyGrad.addColorStop(0, C_SKY_TOP);
      skyGrad.addColorStop(1, C_SKY_BOT);
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H);

      // sun
      const sunY = H * 0.32, sunR = 80;
      const sunGrad = ctx.createRadialGradient(W / 2, sunY, 0, W / 2, sunY, sunR * 2);
      sunGrad.addColorStop(0, C_SUN);
      sunGrad.addColorStop(0.4, C_SUN_GLOW);
      sunGrad.addColorStop(1, "transparent");
      ctx.fillStyle = sunGrad;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = C_SUN;
      ctx.beginPath();
      ctx.arc(W / 2, sunY, sunR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = C_SKY_BOT;
      for (let ly = sunY - sunR; ly < sunY + sunR; ly += 6) {
        if ((Math.floor(ly) % 12) < 4) ctx.fillRect(W / 2 - sunR, ly, sunR * 2, 3);
      }

      // mountains
      ctx.fillStyle = C_MTN;
      ctx.beginPath();
      ctx.moveTo(0, H * 0.45);
      for (let mx = 0; mx <= W; mx += 40) {
        const mh = Math.sin(mx * 0.015) * 30 + Math.sin(mx * 0.007) * 50;
        ctx.lineTo(mx, H * 0.42 - mh);
      }
      ctx.lineTo(W, H * 0.45);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = C_MTN_HI;
      ctx.beginPath();
      ctx.moveTo(0, H * 0.45);
      for (let mx = 0; mx <= W; mx += 40) {
        const mh = Math.sin(mx * 0.012 + 1) * 20 + Math.sin(mx * 0.005 + 2) * 40;
        ctx.lineTo(mx, H * 0.44 - mh);
      }
      ctx.lineTo(W, H * 0.45);
      ctx.closePath();
      ctx.fill();

      // road segments — back-to-front (painters algorithm)
      if (road.length > 0) {
        const worldPos = ((posRef.current % lapWorld) + lapWorld) % lapWorld;
        const camZ = worldPos;
        const startIdx = Math.floor(camZ / SEG_LEN);
        let maxy = H;
        let dx = 0;
        let x = 0;
        const drawDist = Math.min(DRAW_DIST, lapLen);

        // project pass
        for (let n = 0; n < drawDist; n++) {
          const idx = ((startIdx + n) % lapLen + lapLen) % lapLen;
          const seg = road[idx];
          const virtualZ = startIdx * SEG_LEN + n * SEG_LEN;
          const origZ = seg.z;
          seg.z = virtualZ;
          project(seg, xRef.current * ROAD_W / 2 - x, CAM_HEIGHT + seg.y, camZ);
          seg.z = origZ;

          x += dx;
          dx += seg.curve * (seg.pscale > 0 ? seg.pscale : 0);
          seg.px = Math.round(seg.px + x);
          seg.clip = maxy;
          if (seg.py < maxy) maxy = Math.round(seg.py);
        }

        // render pass (far to near)
        for (let n = drawDist - 1; n > 0; n--) {
          const idx = ((startIdx + n) % lapLen + lapLen) % lapLen;
          const seg = road[idx];
          const prev = road[((startIdx + n - 1) % lapLen + lapLen) % lapLen];
          if (seg.pscale <= 0 || prev.pscale <= 0) continue;
          if (prev.py <= seg.clip) continue;

          const isOdd = (Math.floor(n / 3) % 2) === 0;

          // grass
          ctx.fillStyle = isOdd ? C_GRASS_A : C_GRASS_B;
          ctx.fillRect(0, Math.round(prev.py), W, Math.round(seg.py - prev.py + 1));

          if (seg.finish) {
            // checkered finish line
            const cSz = prev.pw / 6;
            for (let ci = -3; ci <= 3; ci++) {
              const cx1 = prev.px + ci * cSz * 2;
              const cx2 = seg.px + ci * cSz * 2;
              poly(ctx, isOdd ? C_FINISH_W : C_FINISH_B,
                cx1, prev.py, cSz * 0.5, cx2, seg.py, cSz * 0.5);
            }
            poly(ctx, isOdd ? C_RUMBLE_A : C_RUMBLE_B,
              prev.px, prev.py, prev.pw * 1.15, seg.px, seg.py, seg.pw * 1.15);
          } else {
            poly(ctx, isOdd ? C_RUMBLE_A : C_RUMBLE_B,
              prev.px, prev.py, prev.pw * 1.15, seg.px, seg.py, seg.pw * 1.15);
            poly(ctx, isOdd ? C_ROAD_A : C_ROAD_B,
              prev.px, prev.py, prev.pw, seg.px, seg.py, seg.pw);
          }

          // lanes
          if (isOdd && !seg.finish) {
            const lw1 = prev.pw / 20;
            const lw2 = seg.pw / 20;
            for (let l = 1; l < LANES; l++) {
              const lx1 = prev.px - prev.pw + (prev.pw * 2 * l / LANES);
              const lx2 = seg.px - seg.pw + (seg.pw * 2 * l / LANES);
              poly(ctx, C_LANE, lx1, prev.py, lw1, lx2, seg.py, lw2);
            }
          }

          // horizon grid lines
          if (isOdd && n < 80) {
            ctx.strokeStyle = "#00FFFF15";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, Math.round(seg.py));
            ctx.lineTo(W, Math.round(seg.py));
            ctx.stroke();
          }

          // checkpoint gate
          if (seg.checkpoint && seg.pscale > 0 && n < 100) {
            const gW = seg.pw * 1.3;
            const gH = seg.pscale * 4000;
            const gx = seg.px, gy = seg.py;
            ctx.fillStyle = "#00FFFF80";
            ctx.fillRect(gx - gW - 4, gy - gH, 8, gH);
            ctx.fillRect(gx + gW - 4, gy - gH, 8, gH);
            ctx.fillStyle = "#FF007F90";
            ctx.fillRect(gx - gW, gy - gH, gW * 2, 6);
            ctx.shadowColor = "#00FFFF";
            ctx.shadowBlur = 15;
            ctx.fillStyle = "#00FFFF40";
            ctx.fillRect(gx - gW, gy - gH - 2, gW * 2, 3);
            ctx.shadowBlur = 0;
            ctx.font = "bold 8px 'Press Start 2P', monospace";
            ctx.fillStyle = "#00FFFF";
            ctx.textAlign = "center";
            ctx.fillText("CHECKPOINT", gx, gy - gH - 8);
            ctx.textAlign = "left";
          }

          // palms
          if (seg.palm && seg.pscale > 0) {
            const sc = seg.pscale * 3000;
            const sx = seg.px + (seg.palmX || 0) * seg.pw;
            const sy = seg.py;
            const sw = sc * 0.4, sh = sc * 1.2;
            ctx.fillStyle = "#4a2060";
            ctx.fillRect(sx - sw * 0.1, sy - sh, sw * 0.2, sh);
            ctx.fillStyle = "#00FFFF60";
            ctx.beginPath();
            ctx.arc(sx, sy - sh, sw * 0.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#FF007F40";
            ctx.beginPath();
            ctx.arc(sx - sw * 0.2, sy - sh * 0.8, sw * 0.3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // off-road tint
      if (offRoadRef.current && phaseRef.current === "playing") {
        ctx.fillStyle = "rgba(255, 0, 50, 0.08)";
        ctx.fillRect(0, 0, W, H);
      }

      // speed blur
      if (phaseRef.current === "playing") {
        const r = speedRef.current / MAX_SPEED;
        if (r > 0.7) {
          const a = (r - 0.7) / 0.3 * 0.25;
          const g1 = ctx.createLinearGradient(0, 0, W * 0.15, 0);
          g1.addColorStop(0, `rgba(0,255,255,${a})`);
          g1.addColorStop(1, "transparent");
          ctx.fillStyle = g1;
          ctx.fillRect(0, H * 0.4, W * 0.15, H * 0.6);
          const g2 = ctx.createLinearGradient(W, 0, W * 0.85, 0);
          g2.addColorStop(0, `rgba(0,255,255,${a})`);
          g2.addColorStop(1, "transparent");
          ctx.fillStyle = g2;
          ctx.fillRect(W * 0.85, H * 0.4, W * 0.15, H * 0.6);
        }
        if (miniBoostRef.current > 0) {
          ctx.fillStyle = `rgba(255, 200, 0, ${0.04 + Math.random() * 0.03})`;
          ctx.fillRect(0, 0, W, H);
        }
      }

      // player kart sprite
      if (phaseRef.current !== "idle") {
        const kW = 54, kH = 34;
        const kX = W / 2, kY = H - 65;
        const isDrifting = driftingRef.current;
        const tilt = isDrifting ? driftDirRef.current * 0.25 : xRef.current * 0.06;

        ctx.save();
        ctx.translate(kX, kY + kH / 2);
        ctx.rotate(tilt);
        ctx.translate(-kX, -(kY + kH / 2));

        // shadow
        ctx.fillStyle = "#00000060";
        ctx.fillRect(kX - kW / 2 - 3, kY - 3, kW + 6, kH + 6);

        // body
        const bodyGrad = ctx.createLinearGradient(kX - kW / 2, kY, kX + kW / 2, kY);
        if (isDrifting) {
          bodyGrad.addColorStop(0, "#FF007F");
          bodyGrad.addColorStop(0.5, "#FF4500");
          bodyGrad.addColorStop(1, "#FF007F");
        } else if (miniBoostRef.current > 0) {
          bodyGrad.addColorStop(0, "#FFFF00");
          bodyGrad.addColorStop(0.5, "#FF8800");
          bodyGrad.addColorStop(1, "#FFFF00");
        } else {
          bodyGrad.addColorStop(0, "#00FFFF");
          bodyGrad.addColorStop(0.5, "#0088FF");
          bodyGrad.addColorStop(1, "#00FFFF");
        }
        ctx.fillStyle = bodyGrad;
        ctx.fillRect(kX - kW / 2, kY, kW, kH);

        // windshield
        ctx.fillStyle = "#240046";
        ctx.fillRect(kX - kW * 0.35, kY + 3, kW * 0.7, kH * 0.35);

        // wheels
        ctx.fillStyle = "#0a0020";
        ctx.fillRect(kX - kW / 2 - 3, kY + 4, 5, kH - 8);
        ctx.fillRect(kX + kW / 2 - 2, kY + 4, 5, kH - 8);

        // tail lights
        ctx.fillStyle = "#FF007F";
        ctx.fillRect(kX - kW / 2, kY + kH - 5, 8, 5);
        ctx.fillRect(kX + kW / 2 - 8, kY + kH - 5, 8, 5);

        // drift sparks
        if (isDrifting) {
          for (let sp = 0; sp < 4; sp++) {
            ctx.fillStyle = `rgba(255, ${150 + Math.random() * 105}, 0, ${0.5 + Math.random() * 0.5})`;
            const spx = kX + (driftDirRef.current > 0 ? -kW / 2 - 5 : kW / 2 + 5) + (Math.random() - 0.5) * 12;
            const spy = kY + kH - 2 + Math.random() * 8;
            ctx.fillRect(spx, spy, 3, 3);
          }
        }

        // boost flame
        if (miniBoostRef.current > 0) {
          ctx.fillStyle = "#FFFF0090";
          ctx.fillRect(kX - 8, kY + kH, 6, 10 + Math.random() * 10);
          ctx.fillRect(kX + 2, kY + kH, 6, 10 + Math.random() * 10);
        }

        ctx.restore();
      }

      // in-canvas HUD (compact status)
      if (phaseRef.current === "playing") {
        if (driftingRef.current) {
          ctx.fillStyle = "#FF007F";
          ctx.font = "bold 10px 'Press Start 2P', monospace";
          ctx.textAlign = "center";
          ctx.fillText("🔥 DRIFT", W / 2, 30);
          ctx.textAlign = "left";
        } else if (miniBoostRef.current > 0) {
          ctx.fillStyle = "#FFFF00";
          ctx.font = "bold 10px 'Press Start 2P', monospace";
          ctx.textAlign = "center";
          ctx.fillText("⚡ BOOST!", W / 2, 30);
          ctx.textAlign = "left";
        }
        if (offRoadRef.current) {
          ctx.fillStyle = "#FF007F";
          ctx.font = "bold 10px 'Press Start 2P', monospace";
          ctx.textAlign = "center";
          ctx.fillText("⚠ GRASS ⚠", W / 2, 50);
          ctx.textAlign = "left";
        }
      }

      // floating texts
      for (const ft of floatsRef.current) {
        const alpha = ft.life / ft.max;
        ctx.globalAlpha = alpha;
        ctx.font = "bold 12px 'Press Start 2P', monospace";
        ctx.fillStyle = "#00FFFF";
        ctx.textAlign = "center";
        ctx.shadowColor = "#00FFFF";
        ctx.shadowBlur = 10;
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        ctx.textAlign = "left";
      }

      ctx.restore();
      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  const schemes: ControlScheme[] = ["arrows", "qwerty", "azerty"];
  const isEnd = phase === "gameover" || phase === "finished";

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-[680px] mx-auto px-4">
      {/* Top HUD */}
      <div className="flex items-center justify-between w-full max-w-[640px]">
        <div className="glass rounded-lg px-4 py-2">
          <span className="text-[10px] text-muted-foreground block">SPEED</span>
          <span className="font-pixel text-sm text-primary neon-text-cyan">{mph} MPH</span>
        </div>

        <div className="flex-1 mx-4">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[9px] text-muted-foreground font-pixel">LAP {currentLap}/{TOTAL_LAPS}</span>
            {bestLap !== null && (
              <span className="text-[9px] text-neon-yellow font-pixel">BEST {bestLap.toFixed(1)}s</span>
            )}
          </div>
          <Progress value={lapPct} className="h-2 bg-muted/30" />
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
                    onClick={() => handleScheme(s)}
                    className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors ${
                      scheme === s
                        ? "bg-primary/20 text-primary neon-text-cyan font-semibold"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`}
                  >
                    <span className="font-pixel text-[9px]">{CONTROL_LABELS[s]}</span>
                    <span className="block text-[10px] mt-0.5 opacity-60">
                      {s === "arrows" ? "← → ↑ ↓" : s === "qwerty" ? "W A S D" : "Z Q S D"}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="glass rounded-lg px-4 py-2 text-right">
          <span className="text-[10px] text-muted-foreground block">TIME</span>
          <span className={`font-pixel text-sm ${timeLeft < 10 ? "text-secondary neon-text-pink" : "text-primary neon-text-cyan"}`}>
            {timeLeft}s
          </span>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative" style={{ maxWidth: W }}>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="block rounded-lg border border-border/50 neon-glow-pink max-w-full"
          style={{ imageRendering: "pixelated" }}
        />

        {phase === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center glass rounded-lg">
            <h2 className="font-pixel text-sm text-secondary neon-text-pink mb-2">SUPER KART RACER</h2>
            <p className="font-pixel text-[8px] text-primary neon-text-cyan mb-1">MODE-7 CIRCUIT · {TOTAL_LAPS} LAPS</p>
            <p className="font-pixel text-[7px] text-neon-yellow mb-4">HOLD SPACE + TURN TO DRIFT</p>
            <p className="text-muted-foreground text-sm mb-6 text-center px-4">{HINTS[scheme]}</p>
            <button
              onClick={startGame}
              className="bg-secondary text-secondary-foreground font-pixel text-[10px] px-6 py-3 rounded-lg neon-glow-pink hover:scale-105 active:scale-95 transition-transform"
            >
              INSERT COIN
            </button>
          </div>
        )}

        {isEnd && (
          <div className="absolute inset-0 flex flex-col items-center justify-center glass rounded-lg overflow-y-auto py-4">
            <h2 className="font-pixel text-sm text-secondary neon-text-pink mb-2">
              {phase === "finished" ? "CIRCUIT COMPLETE!" : crash || "GAME OVER"}
            </h2>
            {phase === "finished" && (
              <>
                <p className="font-pixel text-[8px] text-neon-yellow mb-1">TIME BONUS: {Math.floor(timerRef.current * 100)}</p>
                {bestLap !== null && (
                  <p className="font-pixel text-[8px] text-primary mb-1">BEST LAP: {bestLap.toFixed(2)}s</p>
                )}
              </>
            )}
            <p className="font-pixel text-xs text-primary neon-text-cyan mb-3">{score} PTS</p>
            <GameOverLeaderboard gameId="racer" score={score} />
            <button
              onClick={startGame}
              className="bg-secondary text-secondary-foreground font-pixel text-[10px] px-6 py-3 rounded-lg neon-glow-pink hover:scale-105 active:scale-95 transition-transform mt-3"
            >
              INSERT COIN TO RETRY
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default NeonRacerGame;
