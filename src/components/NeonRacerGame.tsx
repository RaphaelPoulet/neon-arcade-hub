import { useRef, useEffect, useState, useCallback } from "react";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import GameOverLeaderboard from "@/components/GameOverLeaderboard";
import { Progress } from "@/components/ui/progress";

type ControlScheme = "arrows" | "qwerty" | "azerty";
type GameState = "idle" | "playing" | "gameover" | "finished";

const CONTROL_LABELS: Record<ControlScheme, string> = {
  arrows: "Arrows",
  qwerty: "WASD",
  azerty: "ZQSD",
};

const SCHEME_HINT: Record<ControlScheme, string> = {
  arrows: "← → steer · ↑ accel · ↓ brake · Space boost",
  qwerty: "A/D steer · W accel · S brake · Space boost",
  azerty: "Q/D steer · Z accel · S brake · Space boost",
};

const WIDTH = 640;
const HEIGHT = 480;

/* ── road / world constants ── */
const SEG_LENGTH = 200;
const DRAW_DISTANCE = 150;
const ROAD_WIDTH = 2000;
const LANE_COUNT = 3;
const FOV = 100;
const CAM_HEIGHT = 1500;
const CAM_DEPTH = 1 / Math.tan((FOV / 2) * (Math.PI / 180));

/* ── gameplay ── */
const MAX_SPEED = SEG_LENGTH * 60;
const ACCEL = MAX_SPEED / 100;
const BRAKE = -MAX_SPEED / 50;
const DECEL = -MAX_SPEED / 300;          // engine braking (gentle)
const OFF_ROAD_MAX_MULT = 0.3;           // 70% speed reduction off-road
const STEER_SPEED = 3 * 0.6;
const CENTRIFUGAL = 0.35;
const BOOST_MULT = 1.8;
const BOOST_DURATION = 90;
const BOOST_COOLDOWN = 180;
const STEER_LERP = 0.12;

const INITIAL_TIME = 45;
const CHECKPOINT_TIME_ADD = 15;

/* ── screen shake ── */
const SHAKE_INTENSITY = 4;

/* ── colors ── */
const COL_SKY_TOP = "#0a0020";
const COL_SKY_BOT = "#240046";
const COL_SUN_CENTER = "#FF007F";
const COL_SUN_EDGE = "#ff00ff80";
const COL_MOUNTAIN = "#1a0035";
const COL_MOUNTAIN_HIGHLIGHT = "#2d0060";
const COL_GRASS_DARK = "#0a0a2e";
const COL_GRASS_LIGHT = "#0d0d3a";
const COL_ROAD_DARK = "#1a1a3e";
const COL_ROAD_LIGHT = "#222255";
const COL_RUMBLE_DARK = "#FF007F";
const COL_RUMBLE_LIGHT = "#00FFFF";
const COL_LANE = "#ffffff30";
const COL_FINISH_A = "#ffffff";
const COL_FINISH_B = "#111111";

/* ── track definition ── */
interface TrackZone {
  length: number;
  curve: number;
  hill?: number;
  label?: string;
}

// The fixed circuit
const TRACK_LAYOUT: TrackZone[] = [
  { length: 200, curve: 0, label: "START STRAIGHT" },
  { length: 120, curve: 2.5, label: "EASY LEFT" },
  { length: 100, curve: 0 },
  { length: 150, curve: -3, hill: 2500, label: "RIGHT BEND" },
  { length: 80, curve: 0 },
  { length: 100, curve: 2, label: "S-CURVE IN" },
  { length: 100, curve: -2, label: "S-CURVE OUT" },
  { length: 60, curve: 0 },
  { length: 180, curve: -2.5, hill: 3000, label: "LONG RIGHT" },
  { length: 100, curve: 0, label: "BACK STRAIGHT" },
  { length: 130, curve: 3, hill: 1500, label: "HAIRPIN LEFT" },
  { length: 80, curve: 0 },
  { length: 100, curve: -1.5, label: "GENTLE RIGHT" },
  { length: 60, curve: 0 },
  { length: 120, curve: 2, hill: 2000, label: "UPHILL LEFT" },
  { length: 80, curve: 0 },
  { length: 100, curve: -3, label: "SHARP RIGHT" },
  { length: 250, curve: 0, label: "FINAL STRAIGHT" },
];

interface Segment {
  z: number;
  curve: number;
  y: number;
  px: number; py: number; pw: number; pscale: number;
  clip: number;
  sprite?: "palm" | "car";
  spriteX?: number;
  checkpoint?: boolean;
  finish?: boolean;
  zoneLabel?: string;
}

interface EnemyCar {
  segIdx: number;
  offset: number;
  speed: number;
}

interface FloatingText {
  x: number; y: number;
  text: string;
  life: number;
  maxLife: number;
}

function buildCircuit(): { segments: Segment[]; totalSegs: number; checkpointIndices: number[] } {
  const segs: Segment[] = [];
  const checkpointIndices: number[] = [];
  const RAMP = 40; // transition ramp length

  let idx = 0;
  for (const zone of TRACK_LAYOUT) {
    for (let i = 0; i < zone.length; i++) {
      let curve = zone.curve;
      // Smooth ramp in/out
      if (i < RAMP) curve *= i / RAMP;
      else if (zone.length - i < RAMP) curve *= (zone.length - i) / RAMP;

      let y = 0;
      if (zone.hill) {
        y = Math.sin((i / zone.length) * Math.PI) * zone.hill;
      }

      const seg: Segment = {
        z: idx * SEG_LENGTH,
        curve,
        y,
        px: 0, py: 0, pw: 0, pscale: 0,
        clip: HEIGHT,
      };

      // Label first segment of zone
      if (i === 0 && zone.label) {
        seg.zoneLabel = zone.label;
      }

      // Palm trees
      if (idx % 18 === 0 && idx > 5) {
        seg.sprite = "palm";
        seg.spriteX = (idx % 36 === 0 ? 1 : -1) * (1.2 + (idx % 7) * 0.1);
      }

      segs.push(seg);
      idx++;
    }
  }

  const totalSegs = segs.length;

  // Place 3 checkpoints evenly
  const cpInterval = Math.floor(totalSegs / 4);
  for (let c = 1; c <= 3; c++) {
    const cpIdx = c * cpInterval;
    if (cpIdx < totalSegs) {
      segs[cpIdx].checkpoint = true;
      checkpointIndices.push(cpIdx);
    }
  }

  // Finish line: last 10 segments
  for (let f = Math.max(0, totalSegs - 10); f < totalSegs; f++) {
    segs[f].finish = true;
  }

  return { segments: segs, totalSegs, checkpointIndices };
}

function project(seg: Segment, camX: number, camY: number, camZ: number, screenW: number, screenH: number) {
  const dz = seg.z - camZ;
  if (dz <= 0) { seg.pscale = 0; return; }
  seg.pscale = CAM_DEPTH / dz;
  seg.px = screenW / 2 + (seg.pscale * (0 - camX) * screenW / 2);
  seg.py = screenH / 2 - (seg.pscale * (seg.y - camY) * screenH / 2);
  seg.pw = seg.pscale * ROAD_WIDTH * screenW / 2;
}

function drawPoly(ctx: CanvasRenderingContext2D, color: string,
  x1: number, y1: number, w1: number,
  x2: number, y2: number, w2: number) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1 - w1, y1);
  ctx.lineTo(x1 + w1, y1);
  ctx.lineTo(x2 + w2, y2);
  ctx.lineTo(x2 - w2, y2);
  ctx.closePath();
  ctx.fill();
}

const NeonRacerGame = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>("idle");
  const [score, setScore] = useState(0);
  const [speedMph, setSpeedMph] = useState(0);
  const [timeLeft, setTimeLeft] = useState(INITIAL_TIME);
  const [lapProgress, setLapProgress] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [crashReason, setCrashReason] = useState("");
  const [controlScheme, setControlScheme] = useState<ControlScheme>(() => {
    return (localStorage.getItem("arcade-control-scheme") as ControlScheme) || "arrows";
  });

  const stateRef = useRef<GameState>("idle");
  const keysRef = useRef<Set<string>>(new Set());
  const roadRef = useRef<Segment[]>([]);
  const totalSegsRef = useRef(0);
  const checkpointIndicesRef = useRef<number[]>([]);
  const posRef = useRef(0);
  const speedRef = useRef(0);
  const playerXRef = useRef(0);
  const targetXRef = useRef(0);
  const scoreRef = useRef(0);
  const boostRef = useRef(0);
  const boostCoolRef = useRef(0);
  const enemiesRef = useRef<EnemyCar[]>([]);
  const animRef = useRef(0);
  const lastTimeRef = useRef(0);
  const timerRef = useRef(INITIAL_TIME);
  const passedCheckpointsRef = useRef<Set<number>>(new Set());
  const floatingTextsRef = useRef<FloatingText[]>([]);
  const controlSchemeRef = useRef(controlScheme);
  const shakeRef = useRef(0);
  const offRoadRef = useRef(false);

  const handleSchemeChange = useCallback((scheme: ControlScheme) => {
    setControlScheme(scheme);
    controlSchemeRef.current = scheme;
    localStorage.setItem("arcade-control-scheme", scheme);
    setSettingsOpen(false);
    toast(`Controls set to ${CONTROL_LABELS[scheme]}`, { duration: 2000, className: "font-pixel" });
  }, []);

  const isLeft = useCallback((keys: Set<string>) => {
    const cs = controlSchemeRef.current;
    if (cs === "arrows") return keys.has("ArrowLeft");
    if (cs === "qwerty") return keys.has("a") || keys.has("A");
    return keys.has("q") || keys.has("Q");
  }, []);

  const isRight = useCallback((keys: Set<string>) => {
    const cs = controlSchemeRef.current;
    if (cs === "arrows") return keys.has("ArrowRight");
    return keys.has("d") || keys.has("D");
  }, []);

  const isAccel = useCallback((keys: Set<string>) => {
    const cs = controlSchemeRef.current;
    if (cs === "arrows") return keys.has("ArrowUp");
    if (cs === "qwerty") return keys.has("w") || keys.has("W");
    return keys.has("z") || keys.has("Z");
  }, []);

  const isBrake = useCallback((keys: Set<string>) => {
    const cs = controlSchemeRef.current;
    if (cs === "arrows") return keys.has("ArrowDown");
    return keys.has("s") || keys.has("S");
  }, []);

  const startGame = useCallback(() => {
    const { segments, totalSegs, checkpointIndices } = buildCircuit();
    roadRef.current = segments;
    totalSegsRef.current = totalSegs;
    checkpointIndicesRef.current = checkpointIndices;
    posRef.current = 0;
    speedRef.current = 0;
    playerXRef.current = 0;
    targetXRef.current = 0;
    scoreRef.current = 0;
    boostRef.current = 0;
    boostCoolRef.current = 0;
    timerRef.current = INITIAL_TIME;
    passedCheckpointsRef.current = new Set();
    floatingTextsRef.current = [];
    shakeRef.current = 0;
    offRoadRef.current = false;

    // Enemy cars spread across the circuit
    const enemies: EnemyCar[] = [];
    for (let i = 0; i < 40; i++) {
      enemies.push({
        segIdx: 30 + Math.floor(Math.random() * (totalSegs - 60)),
        offset: -0.6 + Math.random() * 1.2,
        speed: MAX_SPEED * (0.25 + Math.random() * 0.25),
      });
    }
    enemiesRef.current = enemies;
    stateRef.current = "playing";
    setGameState("playing");
    setScore(0);
    setSpeedMph(0);
    setTimeLeft(INITIAL_TIME);
    setLapProgress(0);
    setCrashReason("");
  }, []);

  // Input
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      keysRef.current.add(e.key);
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
        e.preventDefault();
      }
      if (stateRef.current === "idle" || stateRef.current === "gameover" || stateRef.current === "finished") {
        if (e.key === "Enter" || e.key === " ") startGame();
      }
    };
    const onUp = (e: KeyboardEvent) => keysRef.current.delete(e.key);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [startGame]);

  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const loop = (time: number) => {
      const dt = lastTimeRef.current ? Math.min((time - lastTimeRef.current) / 1000, 0.05) : 1 / 60;
      lastTimeRef.current = time;

      const W = canvas.width;
      const H = canvas.height;
      const road = roadRef.current;
      const keys = keysRef.current;
      const totalSegs = totalSegsRef.current;
      const totalLength = totalSegs * SEG_LENGTH;

      if (stateRef.current === "playing" && road.length > 0) {
        /* ── UPDATE ── */
        let spd = speedRef.current;
        const boosting = boostRef.current > 0;
        const isOffRoad = Math.abs(playerXRef.current) > 1;
        offRoadRef.current = isOffRoad;
        const effectiveMax = isOffRoad ? MAX_SPEED * OFF_ROAD_MAX_MULT : (boosting ? MAX_SPEED * BOOST_MULT : MAX_SPEED);

        // Acceleration / braking / engine braking
        if (isAccel(keys)) spd += ACCEL;
        else if (isBrake(keys)) spd += BRAKE;
        else spd += DECEL; // engine braking

        // Off-road: hard cap speed
        if (isOffRoad && spd > effectiveMax) {
          spd += -MAX_SPEED / 20; // rapid deceleration
          shakeRef.current = SHAKE_INTENSITY; // screen shake
        }
        spd = Math.max(0, Math.min(spd, effectiveMax));
        speedRef.current = spd;

        // Steering with lerp
        const steerAmt = STEER_SPEED * (spd / MAX_SPEED) * dt * 60;
        const steeringLeft = isLeft(keys);
        const steeringRight = isRight(keys);
        if (steeringLeft) targetXRef.current -= steerAmt;
        if (steeringRight) targetXRef.current += steerAmt;
        if (!steeringLeft && !steeringRight) {
          targetXRef.current *= 0.92;
          if (Math.abs(targetXRef.current) < 0.01) targetXRef.current = 0;
        }
        targetXRef.current = Math.max(-2.5, Math.min(2.5, targetXRef.current));
        playerXRef.current += (targetXRef.current - playerXRef.current) * STEER_LERP;

        // Boost
        if (boostCoolRef.current > 0) boostCoolRef.current--;
        if (keys.has(" ") && boostRef.current <= 0 && boostCoolRef.current <= 0 && spd > MAX_SPEED * 0.3) {
          boostRef.current = BOOST_DURATION;
          boostCoolRef.current = BOOST_COOLDOWN;
        }
        if (boostRef.current > 0) boostRef.current--;

        // Position (NO wrapping — this is a circuit with a finish line)
        posRef.current += spd * dt;

        // Centrifugal force
        const baseIdx = Math.min(Math.floor(posRef.current / SEG_LENGTH), totalSegs - 1);
        if (baseIdx >= 0 && baseIdx < totalSegs) {
          const baseSeg = road[baseIdx];
          playerXRef.current += baseSeg.curve * CENTRIFUGAL * (spd / MAX_SPEED) * dt * 60;
        }

        // Screen shake decay
        if (shakeRef.current > 0) shakeRef.current *= 0.9;
        if (shakeRef.current < 0.1) shakeRef.current = 0;

        // Off-road crash: instant game over if way too far
        if (Math.abs(playerXRef.current) > 1.8) {
          setCrashReason("OFF ROAD!");
          stateRef.current = "gameover";
          setGameState("gameover");
        }

        // Timer
        timerRef.current -= dt;
        setTimeLeft(Math.max(0, Math.ceil(timerRef.current)));

        // Checkpoint detection
        for (const cpIdx of checkpointIndicesRef.current) {
          if (!passedCheckpointsRef.current.has(cpIdx)) {
            if (baseIdx >= cpIdx) {
              passedCheckpointsRef.current.add(cpIdx);
              timerRef.current += CHECKPOINT_TIME_ADD;
              floatingTextsRef.current.push({
                x: W / 2, y: H * 0.3,
                text: `CHECKPOINT +${CHECKPOINT_TIME_ADD}s`,
                life: 70, maxLife: 70,
              });
            }
          }
        }

        // Finish line detection
        if (posRef.current >= totalLength) {
          scoreRef.current = Math.floor(timerRef.current * 100) + Math.floor(posRef.current / SEG_LENGTH);
          stateRef.current = "finished";
          setGameState("finished");
          setScore(Math.floor(scoreRef.current));
        }

        // Time up
        if (timerRef.current <= 0) {
          timerRef.current = 0;
          setCrashReason("TIME'S UP");
          stateRef.current = "gameover";
          setGameState("gameover");
          scoreRef.current = Math.floor(posRef.current / SEG_LENGTH);
          setScore(Math.floor(scoreRef.current));
        }

        // Score & HUD state
        scoreRef.current = Math.floor(posRef.current / SEG_LENGTH);
        setScore(Math.floor(scoreRef.current));
        setSpeedMph(Math.floor(spd / MAX_SPEED * 220));
        setLapProgress(Math.min(100, (posRef.current / totalLength) * 100));

        // Enemy collision
        for (const e of enemiesRef.current) {
          const eDist = (e.segIdx * SEG_LENGTH) - posRef.current;
          if (eDist > 0 && eDist < SEG_LENGTH * 2) {
            if (Math.abs(playerXRef.current - e.offset) < 0.4) {
              setCrashReason("WRECKED!");
              stateRef.current = "gameover";
              setGameState("gameover");
              break;
            }
          }
          e.segIdx += e.speed * dt / SEG_LENGTH;
          if (e.segIdx >= totalSegs) e.segIdx = totalSegs - 1; // don't wrap
        }

        // Floating texts
        floatingTextsRef.current = floatingTextsRef.current
          .map(ft => ({ ...ft, life: ft.life - 1, y: ft.y - 0.8 }))
          .filter(ft => ft.life > 0);
      }

      /* ── RENDER ── */
      ctx.save();
      // Screen shake offset
      if (shakeRef.current > 0) {
        const sx = (Math.random() - 0.5) * shakeRef.current * 2;
        const sy = (Math.random() - 0.5) * shakeRef.current * 2;
        ctx.translate(sx, sy);
      }

      const skyGrad = ctx.createLinearGradient(0, 0, 0, H / 2);
      skyGrad.addColorStop(0, COL_SKY_TOP);
      skyGrad.addColorStop(1, COL_SKY_BOT);
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H);

      // Sun
      const sunY = H * 0.32;
      const sunR = 80;
      const sunGrad = ctx.createRadialGradient(W / 2, sunY, 0, W / 2, sunY, sunR * 2);
      sunGrad.addColorStop(0, COL_SUN_CENTER);
      sunGrad.addColorStop(0.4, COL_SUN_EDGE);
      sunGrad.addColorStop(1, "transparent");
      ctx.fillStyle = sunGrad;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = COL_SUN_CENTER;
      ctx.beginPath();
      ctx.arc(W / 2, sunY, sunR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = COL_SKY_BOT;
      for (let ly = sunY - sunR; ly < sunY + sunR; ly += 6) {
        if ((Math.floor(ly) % 12) < 4) {
          ctx.fillRect(W / 2 - sunR, ly, sunR * 2, 3);
        }
      }

      // Mountains
      ctx.fillStyle = COL_MOUNTAIN;
      ctx.beginPath();
      ctx.moveTo(0, H * 0.45);
      for (let mx = 0; mx <= W; mx += 40) {
        const mh = Math.sin(mx * 0.015) * 30 + Math.sin(mx * 0.007) * 50;
        ctx.lineTo(mx, H * 0.42 - mh);
      }
      ctx.lineTo(W, H * 0.45);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = COL_MOUNTAIN_HIGHLIGHT;
      ctx.beginPath();
      ctx.moveTo(0, H * 0.45);
      for (let mx = 0; mx <= W; mx += 40) {
        const mh = Math.sin(mx * 0.012 + 1) * 20 + Math.sin(mx * 0.005 + 2) * 40;
        ctx.lineTo(mx, H * 0.44 - mh);
      }
      ctx.lineTo(W, H * 0.45);
      ctx.closePath();
      ctx.fill();

      // Road rendering
      if (road.length > 0) {
        const camZ = posRef.current;
        const startIdx = Math.floor(camZ / SEG_LENGTH);
        let maxy = H;
        let dx = 0;
        let x = 0;

        const drawDist = Math.min(DRAW_DISTANCE, totalSegs - startIdx);

        for (let n = 0; n < drawDist; n++) {
          const idx = startIdx + n;
          if (idx >= totalSegs) break;
          const seg = road[idx];

          project(seg, playerXRef.current * ROAD_WIDTH / 2 - x, CAM_HEIGHT + seg.y, camZ, W, H);

          x += dx;
          dx += seg.curve * seg.pscale;

          seg.px += x;
          seg.clip = maxy;
          if (seg.py < maxy) maxy = seg.py;
        }

        for (let n = drawDist - 1; n > 0; n--) {
          const idx = startIdx + n;
          if (idx >= totalSegs) continue;
          const seg = road[idx];
          const prevIdx = startIdx + n - 1;
          if (prevIdx < 0 || prevIdx >= totalSegs) continue;
          const prev = road[prevIdx];

          if (seg.pscale <= 0 || prev.pscale <= 0) continue;

          const isOdd = (Math.floor(idx / 3) % 2) === 0;

          // Grass
          ctx.fillStyle = isOdd ? COL_GRASS_DARK : COL_GRASS_LIGHT;
          ctx.fillRect(0, prev.py, W, seg.py - prev.py);

          // Finish line checkered pattern
          if (seg.finish) {
            const checkerSize = prev.pw / 6;
            for (let ci = -3; ci <= 3; ci++) {
              const cx1 = prev.px + ci * checkerSize * 2;
              const cx2 = seg.px + ci * checkerSize * 2;
              drawPoly(ctx, isOdd ? COL_FINISH_A : COL_FINISH_B,
                cx1, prev.py, checkerSize * 0.5,
                cx2, seg.py, checkerSize * 0.5);
            }
            // Rumble still visible
            drawPoly(ctx, isOdd ? COL_RUMBLE_DARK : COL_RUMBLE_LIGHT,
              prev.px, prev.py, prev.pw * 1.15,
              seg.px, seg.py, seg.pw * 1.15);
          } else {
            // Rumble
            drawPoly(ctx, isOdd ? COL_RUMBLE_DARK : COL_RUMBLE_LIGHT,
              prev.px, prev.py, prev.pw * 1.15,
              seg.px, seg.py, seg.pw * 1.15);

            // Road
            drawPoly(ctx, isOdd ? COL_ROAD_DARK : COL_ROAD_LIGHT,
              prev.px, prev.py, prev.pw,
              seg.px, seg.py, seg.pw);
          }

          // Lanes
          if (isOdd && !seg.finish) {
            const laneW1 = prev.pw / 20;
            const laneW2 = seg.pw / 20;
            for (let l = 1; l < LANE_COUNT; l++) {
              const lx1 = prev.px - prev.pw + (prev.pw * 2 * l / LANE_COUNT);
              const lx2 = seg.px - seg.pw + (seg.pw * 2 * l / LANE_COUNT);
              drawPoly(ctx, COL_LANE, lx1, prev.py, laneW1, lx2, seg.py, laneW2);
            }
          }

          // Grid lines
          if (isOdd && n < 80) {
            ctx.strokeStyle = "#00FFFF15";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, seg.py);
            ctx.lineTo(W, seg.py);
            ctx.stroke();
          }

          // Checkpoint gate
          if (seg.checkpoint && seg.pscale > 0 && n < 100) {
            const gateW = seg.pw * 1.3;
            const gateH = seg.pscale * 4000;
            const gx = seg.px;
            const gy = seg.py;
            ctx.fillStyle = "#00FFFF80";
            ctx.fillRect(gx - gateW - 4, gy - gateH, 8, gateH);
            ctx.fillRect(gx + gateW - 4, gy - gateH, 8, gateH);
            ctx.fillStyle = "#FF007F90";
            ctx.fillRect(gx - gateW, gy - gateH, gateW * 2, 6);
            ctx.shadowColor = "#00FFFF";
            ctx.shadowBlur = 15;
            ctx.fillStyle = "#00FFFF40";
            ctx.fillRect(gx - gateW, gy - gateH - 2, gateW * 2, 3);
            ctx.shadowBlur = 0;
            // Label
            ctx.font = "bold 8px 'Press Start 2P', monospace";
            ctx.fillStyle = "#00FFFF";
            ctx.textAlign = "center";
            ctx.fillText("NEON GATE", gx, gy - gateH - 8);
            ctx.textAlign = "left";
          }

          // Palms
          if (seg.sprite === "palm" && seg.pscale > 0) {
            const spriteScale = seg.pscale * 3000;
            const sx = seg.px + (seg.spriteX || 0) * seg.pw;
            const sy = seg.py;
            const sw = spriteScale * 0.4;
            const sh = spriteScale * 1.2;
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

          // Enemy cars
          for (const e of enemiesRef.current) {
            const eIdx = Math.floor(e.segIdx);
            if (eIdx === idx && seg.pscale > 0) {
              const carScale = seg.pscale * 2000;
              const cx = seg.px + e.offset * seg.pw;
              const cy = seg.py;
              const cw = carScale * 0.35;
              const ch = carScale * 0.25;
              ctx.fillStyle = "#FF007F";
              ctx.fillRect(cx - cw / 2, cy - ch, cw, ch);
              ctx.fillStyle = "#00FFFF80";
              ctx.fillRect(cx - cw * 0.3, cy - ch * 0.9, cw * 0.6, ch * 0.3);
              ctx.fillStyle = "#FFFF0060";
              ctx.fillRect(cx - cw * 0.4, cy - ch * 0.2, cw * 0.15, ch * 0.15);
              ctx.fillRect(cx + cw * 0.25, cy - ch * 0.2, cw * 0.15, ch * 0.15);
            }
          }
        }
      }

      // Off-road red tint
      if (offRoadRef.current && stateRef.current === "playing") {
        ctx.fillStyle = "rgba(255, 0, 50, 0.08)";
        ctx.fillRect(0, 0, W, H);
      }

      // Speed blur effect at edges
      if (stateRef.current === "playing") {
        const spdRatio = speedRef.current / MAX_SPEED;
        if (spdRatio > 0.7) {
          const blurAlpha = (spdRatio - 0.7) / 0.3 * 0.25;
          const grad1 = ctx.createLinearGradient(0, 0, W * 0.15, 0);
          grad1.addColorStop(0, `rgba(0, 255, 255, ${blurAlpha})`);
          grad1.addColorStop(1, "transparent");
          ctx.fillStyle = grad1;
          ctx.fillRect(0, H * 0.4, W * 0.15, H * 0.6);
          const grad2 = ctx.createLinearGradient(W, 0, W * 0.85, 0);
          grad2.addColorStop(0, `rgba(0, 255, 255, ${blurAlpha})`);
          grad2.addColorStop(1, "transparent");
          ctx.fillStyle = grad2;
          ctx.fillRect(W * 0.85, H * 0.4, W * 0.15, H * 0.6);
        }
      }

      // Player car
      if (stateRef.current === "playing" || stateRef.current === "gameover" || stateRef.current === "finished") {
        const carW = 50;
        const carH = 30;
        const carX = W / 2;
        const carY = H - 60;

        // Car rotation based on steering
        const steerAngle = (targetXRef.current / 2.5) * 0.15;
        ctx.save();
        ctx.translate(carX, carY + carH / 2);
        ctx.rotate(steerAngle);
        ctx.translate(-carX, -(carY + carH / 2));

        ctx.fillStyle = "#00000060";
        ctx.fillRect(carX - carW / 2 - 3, carY - 3, carW + 6, carH + 6);

        const carGrad = ctx.createLinearGradient(carX - carW / 2, carY, carX + carW / 2, carY);
        carGrad.addColorStop(0, "#00FFFF");
        carGrad.addColorStop(0.5, "#0088FF");
        carGrad.addColorStop(1, "#00FFFF");
        ctx.fillStyle = carGrad;
        ctx.fillRect(carX - carW / 2, carY, carW, carH);

        ctx.fillStyle = "#240046";
        ctx.fillRect(carX - carW * 0.35, carY + 2, carW * 0.7, carH * 0.35);

        ctx.fillStyle = "#FF007F";
        ctx.fillRect(carX - carW / 2, carY + carH - 5, 8, 5);
        ctx.fillRect(carX + carW / 2 - 8, carY + carH - 5, 8, 5);

        if (boostRef.current > 0) {
          ctx.fillStyle = "#FF007F90";
          ctx.fillRect(carX - 8, carY + carH, 6, 10 + Math.random() * 10);
          ctx.fillRect(carX + 2, carY + carH, 6, 10 + Math.random() * 10);
        }

        ctx.restore();

        // Boost screen flash
        if (boostRef.current > 0) {
          ctx.fillStyle = `rgba(255, 0, 127, ${0.03 + Math.random() * 0.03})`;
          ctx.fillRect(0, 0, W, H);
        }
      }

      // Canvas HUD
      if (stateRef.current === "playing") {
        // Speed + Time panel
        ctx.fillStyle = "rgba(10, 0, 30, 0.7)";
        ctx.strokeStyle = "#00FFFF40";
        ctx.lineWidth = 1;
        const hudX = 10, hudY = 10, hudW = 160, hudH = 70;
        ctx.beginPath();
        ctx.roundRect(hudX, hudY, hudW, hudH, 8);
        ctx.fill();
        ctx.stroke();

        ctx.font = "bold 10px 'Press Start 2P', monospace";
        ctx.fillStyle = "#00FFFF";
        ctx.fillText(`${Math.floor(speedRef.current / MAX_SPEED * 220)} MPH`, hudX + 10, hudY + 22);

        const tColor = timerRef.current < 10 ? "#FF007F" : "#FFFF00";
        ctx.fillStyle = tColor;
        ctx.fillText(`TIME ${Math.ceil(timerRef.current)}s`, hudX + 10, hudY + 42);

        ctx.fillStyle = "#FFFFFF60";
        ctx.font = "7px 'Press Start 2P', monospace";
        const prog = Math.min(100, (posRef.current / (totalSegsRef.current * SEG_LENGTH)) * 100);
        ctx.fillText(`LAP ${Math.floor(prog)}%`, hudX + 10, hudY + 58);

        // Boost indicator
        if (boostCoolRef.current <= 0 && speedRef.current > MAX_SPEED * 0.3) {
          ctx.fillStyle = "#FFFF00";
          ctx.font = "7px 'Press Start 2P', monospace";
          ctx.fillText("BOOST READY", W - 120, 25);
        } else if (boostRef.current > 0) {
          ctx.fillStyle = "#FF007F";
          ctx.font = "7px 'Press Start 2P', monospace";
          ctx.fillText("BOOST!", W - 80, 25);
        }

        // Off-road warning
        if (offRoadRef.current) {
          ctx.fillStyle = "#FF007F";
          ctx.font = "bold 10px 'Press Start 2P', monospace";
          ctx.textAlign = "center";
          ctx.fillText("⚠ OFF ROAD ⚠", W / 2, 30);
          ctx.textAlign = "left";
        }
      }

      // Floating texts
      for (const ft of floatingTextsRef.current) {
        const alpha = ft.life / ft.maxLife;
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
  }, [isLeft, isRight, isAccel, isBrake]);

  const schemes: ControlScheme[] = ["arrows", "qwerty", "azerty"];
  const isEndState = gameState === "gameover" || gameState === "finished";

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-[680px] mx-auto px-4">
      {/* HUD Bar */}
      <div className="flex items-center justify-between w-full max-w-[640px]">
        <div className="glass rounded-lg px-4 py-2">
          <span className="text-[10px] text-muted-foreground block">SPEED</span>
          <span className="font-pixel text-sm text-primary neon-text-cyan">{speedMph} MPH</span>
        </div>

        {/* Lap Progress */}
        <div className="flex-1 mx-4">
          <span className="text-[9px] text-muted-foreground font-pixel block text-center mb-1">LAP PROGRESS</span>
          <Progress value={lapProgress} className="h-2 bg-muted/30" />
        </div>

        {/* Settings */}
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
      <div className="relative" style={{ maxWidth: WIDTH }}>
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="block rounded-lg border border-border/50 neon-glow-pink max-w-full"
          style={{ imageRendering: "pixelated" }}
        />

        {/* Idle overlay */}
        {gameState === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center glass rounded-lg">
            <h2 className="font-pixel text-sm text-secondary neon-text-pink mb-2">NEON RACER</h2>
            <p className="font-pixel text-[8px] text-primary neon-text-cyan mb-4">CIRCUIT MODE</p>
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

        {/* Game over overlay */}
        {isEndState && (
          <div className="absolute inset-0 flex flex-col items-center justify-center glass rounded-lg overflow-y-auto py-4">
            <h2 className="font-pixel text-sm text-secondary neon-text-pink mb-2">
              {gameState === "finished" ? "CIRCUIT COMPLETE!" : crashReason || "GAME OVER"}
            </h2>
            {gameState === "finished" && (
              <p className="font-pixel text-[8px] text-neon-yellow mb-1">TIME BONUS: {Math.floor(timerRef.current * 100)}</p>
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
