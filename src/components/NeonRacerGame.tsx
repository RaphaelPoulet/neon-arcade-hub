import { useRef, useEffect, useState, useCallback } from "react";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import GameOverLeaderboard from "@/components/GameOverLeaderboard";
import { Progress } from "@/components/ui/progress";

type ControlScheme = "arrows" | "qwerty" | "azerty";
type GameState = "idle" | "playing" | "gameover" | "finished";
type DriftState = "none" | "charging" | "drifting";

const CONTROL_LABELS: Record<ControlScheme, string> = {
  arrows: "Arrows",
  qwerty: "WASD",
  azerty: "ZQSD",
};

const SCHEME_HINT: Record<ControlScheme, string> = {
  arrows: "← → steer · ↑ accel · ↓ brake · Space drift",
  qwerty: "A/D steer · W accel · S brake · Space drift",
  azerty: "Q/D steer · Z accel · S brake · Space drift",
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
const DECEL = -MAX_SPEED / 300;
const OFF_ROAD_MAX_MULT = 0.3;
const STEER_SPEED = 3 * 0.6;
const CENTRIFUGAL = 0.35;
const STEER_LERP = 0.12;

/* ── drift constants ── */
const DRIFT_ENTRY_TIME = 0.5;       // seconds holding turn before drift starts
const DRIFT_SPEED_PENALTY = 0.92;   // speed multiplier while drifting
const DRIFT_LATERAL_BOOST = 1.8;    // extra lateral push outward
const DRIFT_MINI_BOOST_MULT = 1.6;
const DRIFT_MINI_BOOST_DURATION = 60; // frames

const INITIAL_TIME = 50;
const CHECKPOINT_TIME_ADD = 15;
const TOTAL_LAPS = 3;

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
  // projected values - recomputed each frame
  px: number; py: number; pw: number; pscale: number;
  clip: number;
  sprite?: "palm";
  spriteX?: number;
  checkpoint?: boolean;
  finish?: boolean;
  zoneLabel?: string;
}

interface FloatingText {
  x: number; y: number;
  text: string;
  life: number;
  maxLife: number;
}

function buildCircuit(): { segments: Segment[]; lapLength: number; checkpointIndices: number[] } {
  const segs: Segment[] = [];
  const checkpointIndices: number[] = [];
  const RAMP = 40;

  let idx = 0;
  for (const zone of TRACK_LAYOUT) {
    for (let i = 0; i < zone.length; i++) {
      let curve = zone.curve;
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

      if (i === 0 && zone.label) seg.zoneLabel = zone.label;

      if (idx % 18 === 0 && idx > 5) {
        seg.sprite = "palm";
        seg.spriteX = (idx % 36 === 0 ? 1 : -1) * (1.2 + (idx % 7) * 0.1);
      }

      segs.push(seg);
      idx++;
    }
  }

  const lapLength = segs.length;

  // 3 checkpoints per lap
  const cpInterval = Math.floor(lapLength / 4);
  for (let c = 1; c <= 3; c++) {
    const cpIdx = c * cpInterval;
    if (cpIdx < lapLength) {
      segs[cpIdx].checkpoint = true;
      checkpointIndices.push(cpIdx);
    }
  }

  // Finish line: last 10 segments
  for (let f = Math.max(0, lapLength - 10); f < lapLength; f++) {
    segs[f].finish = true;
  }

  return { segments: segs, lapLength, checkpointIndices };
}

function projectSeg(seg: Segment, camX: number, camY: number, camZ: number, W: number, H: number) {
  const dz = seg.z - camZ;
  if (dz <= 0) { seg.pscale = 0; return; }
  seg.pscale = CAM_DEPTH / dz;
  seg.px = Math.round(W / 2 + (seg.pscale * (0 - camX) * W / 2));
  seg.py = Math.round(H / 2 - (seg.pscale * (seg.y - camY) * H / 2));
  seg.pw = Math.round(seg.pscale * ROAD_WIDTH * W / 2);
}

function drawPoly(ctx: CanvasRenderingContext2D, color: string,
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

const NeonRacerGame = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>("idle");
  const [score, setScore] = useState(0);
  const [speedMph, setSpeedMph] = useState(0);
  const [timeLeft, setTimeLeft] = useState(INITIAL_TIME);
  const [lapProgress, setLapProgress] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [crashReason, setCrashReason] = useState("");
  const [currentLap, setCurrentLap] = useState(1);
  const [bestLapTime, setBestLapTime] = useState<number | null>(null);
  const [driftDisplay, setDriftDisplay] = useState<DriftState>("none");
  const [controlScheme, setControlScheme] = useState<ControlScheme>(() => {
    return (localStorage.getItem("arcade-control-scheme") as ControlScheme) || "arrows";
  });

  const stateRef = useRef<GameState>("idle");
  const keysRef = useRef<Set<string>>(new Set());
  const roadRef = useRef<Segment[]>([]);
  const lapLengthRef = useRef(0);
  const checkpointIndicesRef = useRef<number[]>([]);
  const posRef = useRef(0);
  const speedRef = useRef(0);
  const playerXRef = useRef(0);
  const targetXRef = useRef(0);
  const scoreRef = useRef(0);
  const animRef = useRef(0);
  const lastTimeRef = useRef(0);
  const timerRef = useRef(INITIAL_TIME);
  const passedCheckpointsRef = useRef<Set<string>>(new Set());
  const floatingTextsRef = useRef<FloatingText[]>([]);
  const controlSchemeRef = useRef(controlScheme);
  const shakeRef = useRef(0);
  const offRoadRef = useRef(false);

  // Lap tracking
  const currentLapRef = useRef(1);
  const lapStartTimeRef = useRef(0);
  const bestLapTimeRef = useRef<number | null>(null);

  // Drift state
  const driftStateRef = useRef<DriftState>("none");
  const steerHoldTimeRef = useRef(0);
  const driftDirRef = useRef(0); // -1 left, 1 right
  const miniBoostRef = useRef(0);

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

  const isHandbrake = useCallback((keys: Set<string>) => {
    return keys.has(" ");
  }, []);

  const startGame = useCallback(() => {
    const { segments, lapLength, checkpointIndices } = buildCircuit();
    roadRef.current = segments;
    lapLengthRef.current = lapLength;
    checkpointIndicesRef.current = checkpointIndices;
    posRef.current = 0;
    speedRef.current = 0;
    playerXRef.current = 0;
    targetXRef.current = 0;
    scoreRef.current = 0;
    timerRef.current = INITIAL_TIME;
    passedCheckpointsRef.current = new Set();
    floatingTextsRef.current = [];
    shakeRef.current = 0;
    offRoadRef.current = false;
    currentLapRef.current = 1;
    lapStartTimeRef.current = 0;
    bestLapTimeRef.current = null;
    driftStateRef.current = "none";
    steerHoldTimeRef.current = 0;
    driftDirRef.current = 0;
    miniBoostRef.current = 0;

    stateRef.current = "playing";
    setGameState("playing");
    setScore(0);
    setSpeedMph(0);
    setTimeLeft(INITIAL_TIME);
    setLapProgress(0);
    setCrashReason("");
    setCurrentLap(1);
    setBestLapTime(null);
    setDriftDisplay("none");
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
      const lapLength = lapLengthRef.current;
      const lapWorldLength = lapLength * SEG_LENGTH;

      if (stateRef.current === "playing" && road.length > 0) {
        /* ── UPDATE ── */
        let spd = speedRef.current;
        const isMiniBoost = miniBoostRef.current > 0;
        const isOffRoad = Math.abs(playerXRef.current) > 1;
        offRoadRef.current = isOffRoad;
        const isDrifting = driftStateRef.current === "drifting";
        
        let effectiveMax = MAX_SPEED;
        if (isOffRoad) effectiveMax = MAX_SPEED * OFF_ROAD_MAX_MULT;
        else if (isMiniBoost) effectiveMax = MAX_SPEED * DRIFT_MINI_BOOST_MULT;
        else if (isDrifting) effectiveMax = MAX_SPEED * DRIFT_SPEED_PENALTY;

        // Acceleration / braking / engine braking
        if (isAccel(keys)) spd += ACCEL;
        else if (isBrake(keys)) spd += BRAKE;
        else spd += DECEL;

        // Off-road: hard cap speed
        if (isOffRoad && spd > effectiveMax) {
          spd += -MAX_SPEED / 20;
          shakeRef.current = SHAKE_INTENSITY;
        }
        spd = Math.max(0, Math.min(spd, effectiveMax));
        speedRef.current = spd;

        // Steering with lerp
        const steerAmt = STEER_SPEED * (spd / MAX_SPEED) * dt * 60;
        const steeringLeft = isLeft(keys);
        const steeringRight = isRight(keys);
        const steering = steeringLeft || steeringRight;
        const steerDir = steeringLeft ? -1 : steeringRight ? 1 : 0;

        if (steeringLeft) targetXRef.current -= steerAmt;
        if (steeringRight) targetXRef.current += steerAmt;
        if (!steering) {
          targetXRef.current *= 0.92;
          if (Math.abs(targetXRef.current) < 0.01) targetXRef.current = 0;
        }
        targetXRef.current = Math.max(-2.5, Math.min(2.5, targetXRef.current));
        playerXRef.current += (targetXRef.current - playerXRef.current) * STEER_LERP;

        /* ── DRIFT SYSTEM ── */
        if (steering && spd > MAX_SPEED * 0.4) {
          steerHoldTimeRef.current += dt;
        } else {
          steerHoldTimeRef.current = 0;
        }

        const handbrake = isHandbrake(keys);
        const prevDrift = driftStateRef.current;

        if (driftStateRef.current === "none") {
          // Enter drift: holding turn long enough OR handbrake + turning
          if (steering && spd > MAX_SPEED * 0.4 &&
              (steerHoldTimeRef.current > DRIFT_ENTRY_TIME || handbrake)) {
            driftStateRef.current = "charging";
            driftDirRef.current = steerDir;
          }
        }

        if (driftStateRef.current === "charging") {
          if (!steering || spd < MAX_SPEED * 0.2) {
            // Release drift → mini-boost!
            driftStateRef.current = "none";
            miniBoostRef.current = DRIFT_MINI_BOOST_DURATION;
            floatingTextsRef.current.push({
              x: W / 2, y: H * 0.4,
              text: "MINI BOOST!",
              life: 40, maxLife: 40,
            });
          } else {
            // Drift is active: push outward (centrifugal-like)
            playerXRef.current += driftDirRef.current * DRIFT_LATERAL_BOOST * (spd / MAX_SPEED) * dt;
            driftStateRef.current = "drifting";
          }
        }

        if (driftStateRef.current === "drifting") {
          if (!steering || spd < MAX_SPEED * 0.2) {
            // Release drift → mini-boost!
            driftStateRef.current = "none";
            miniBoostRef.current = DRIFT_MINI_BOOST_DURATION;
            steerHoldTimeRef.current = 0;
            floatingTextsRef.current.push({
              x: W / 2, y: H * 0.4,
              text: "MINI BOOST!",
              life: 40, maxLife: 40,
            });
          } else {
            // Continue drifting outward
            playerXRef.current += driftDirRef.current * DRIFT_LATERAL_BOOST * (spd / MAX_SPEED) * dt;
          }
        }

        if (prevDrift !== driftStateRef.current) {
          setDriftDisplay(driftStateRef.current);
        }

        if (miniBoostRef.current > 0) miniBoostRef.current--;

        // Position (wraps per lap)
        posRef.current += spd * dt;

        // Centrifugal force from road curve
        const worldPos = posRef.current % lapWorldLength;
        const baseIdx = Math.min(Math.floor(worldPos / SEG_LENGTH), lapLength - 1);
        if (baseIdx >= 0 && baseIdx < lapLength) {
          const baseSeg = road[baseIdx];
          playerXRef.current += baseSeg.curve * CENTRIFUGAL * (spd / MAX_SPEED) * dt * 60;
        }

        // Screen shake decay
        if (shakeRef.current > 0) shakeRef.current *= 0.9;
        if (shakeRef.current < 0.1) shakeRef.current = 0;

        // Off-road crash
        if (Math.abs(playerXRef.current) > 1.8) {
          setCrashReason("OFF ROAD!");
          stateRef.current = "gameover";
          setGameState("gameover");
          scoreRef.current = Math.floor(posRef.current / SEG_LENGTH);
          setScore(scoreRef.current);
        }

        // Timer
        timerRef.current -= dt;
        setTimeLeft(Math.max(0, Math.ceil(timerRef.current)));

        // Checkpoint detection (per lap)
        const lap = currentLapRef.current;
        for (const cpIdx of checkpointIndicesRef.current) {
          const key = `${lap}-${cpIdx}`;
          if (!passedCheckpointsRef.current.has(key)) {
            if (baseIdx >= cpIdx) {
              passedCheckpointsRef.current.add(key);
              timerRef.current += CHECKPOINT_TIME_ADD;
              floatingTextsRef.current.push({
                x: W / 2, y: H * 0.3,
                text: `CHECKPOINT +${CHECKPOINT_TIME_ADD}s`,
                life: 70, maxLife: 70,
              });
            }
          }
        }

        // Lap completion
        const totalLapPos = posRef.current / lapWorldLength;
        const completedLaps = Math.floor(totalLapPos);
        if (completedLaps >= currentLapRef.current) {
          // Record lap time
          const elapsed = INITIAL_TIME - timerRef.current + 
            (currentLapRef.current - 1) * 0; // approximate
          const lapTime = time / 1000 - lapStartTimeRef.current;
          if (bestLapTimeRef.current === null || lapTime < bestLapTimeRef.current) {
            bestLapTimeRef.current = lapTime;
            setBestLapTime(lapTime);
          }
          lapStartTimeRef.current = time / 1000;

          if (completedLaps >= TOTAL_LAPS) {
            // FINISHED ALL LAPS
            scoreRef.current = Math.floor(timerRef.current * 100) + Math.floor(posRef.current / SEG_LENGTH);
            stateRef.current = "finished";
            setGameState("finished");
            setScore(scoreRef.current);
          } else {
            currentLapRef.current = completedLaps + 1;
            setCurrentLap(currentLapRef.current);
            floatingTextsRef.current.push({
              x: W / 2, y: H * 0.25,
              text: `LAP ${currentLapRef.current}/${TOTAL_LAPS}`,
              life: 80, maxLife: 80,
            });
          }
        }

        // Time up
        if (timerRef.current <= 0) {
          timerRef.current = 0;
          setCrashReason("TIME'S UP");
          stateRef.current = "gameover";
          setGameState("gameover");
          scoreRef.current = Math.floor(posRef.current / SEG_LENGTH);
          setScore(scoreRef.current);
        }

        // Score & HUD state
        scoreRef.current = Math.floor(posRef.current / SEG_LENGTH);
        setScore(scoreRef.current);
        setSpeedMph(Math.floor(spd / MAX_SPEED * 220));
        const lapProg = ((posRef.current % lapWorldLength) / lapWorldLength) * 100;
        setLapProgress(Math.min(100, lapProg));

        // Floating texts
        floatingTextsRef.current = floatingTextsRef.current
          .map(ft => ({ ...ft, life: ft.life - 1, y: ft.y - 0.8 }))
          .filter(ft => ft.life > 0);
      }

      /* ── RENDER ── */
      ctx.save();
      if (shakeRef.current > 0) {
        const sx = (Math.random() - 0.5) * shakeRef.current * 2;
        const sy = (Math.random() - 0.5) * shakeRef.current * 2;
        ctx.translate(Math.round(sx), Math.round(sy));
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

      // Road rendering — strict back-to-front with sub-pixel rounding
      if (road.length > 0) {
        const lapWorldLength = lapLength * SEG_LENGTH;
        const worldPos = posRef.current % lapWorldLength;
        const camZ = worldPos;
        const startIdx = Math.floor(camZ / SEG_LENGTH);
        let maxy = H;
        let dx = 0;
        let x = 0;

        const drawDist = Math.min(DRAW_DISTANCE, lapLength);

        // Forward pass: project all visible segments
        for (let n = 0; n < drawDist; n++) {
          const idx = (startIdx + n) % lapLength;
          const seg = road[idx];

          // Compute virtual Z for projection (continuous, not wrapped)
          const virtualZ = startIdx * SEG_LENGTH + n * SEG_LENGTH;

          // Temporarily set seg.z to virtualZ for projection
          const origZ = seg.z;
          seg.z = virtualZ;
          projectSeg(seg, playerXRef.current * ROAD_WIDTH / 2 - x, CAM_HEIGHT + seg.y, camZ, W, H);
          seg.z = origZ;

          x += dx;
          dx += seg.curve * (seg.pscale > 0 ? seg.pscale : 0);

          seg.px = Math.round(seg.px + x);
          seg.clip = maxy;
          if (seg.py < maxy) maxy = Math.round(seg.py);
        }

        // Back-to-front rendering (painters algorithm)
        for (let n = drawDist - 1; n > 0; n--) {
          const idx = (startIdx + n) % lapLength;
          const seg = road[idx];
          const prevIdx = (startIdx + n - 1) % lapLength;
          const prev = road[prevIdx];

          if (seg.pscale <= 0 || prev.pscale <= 0) continue;
          // Clip: don't draw below already-drawn closer road
          if (prev.py <= seg.clip) continue;

          const isOdd = (Math.floor(n / 3) % 2) === 0;

          // Grass
          ctx.fillStyle = isOdd ? COL_GRASS_DARK : COL_GRASS_LIGHT;
          ctx.fillRect(0, Math.round(prev.py), W, Math.round(seg.py - prev.py + 1));

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
            ctx.moveTo(0, Math.round(seg.py));
            ctx.lineTo(W, Math.round(seg.py));
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

        // Mini-boost flash
        if (miniBoostRef.current > 0) {
          ctx.fillStyle = `rgba(255, 200, 0, ${0.04 + Math.random() * 0.03})`;
          ctx.fillRect(0, 0, W, H);
        }
      }

      // Player car
      if (stateRef.current === "playing" || stateRef.current === "gameover" || stateRef.current === "finished") {
        const carW = 50;
        const carH = 30;
        const carX = W / 2;
        const carY = H - 60;

        // Car rotation: enhanced during drift
        const isDrifting = driftStateRef.current === "drifting" || driftStateRef.current === "charging";
        const driftTilt = isDrifting ? driftDirRef.current * 0.25 : 0;
        const steerAngle = (targetXRef.current / 2.5) * 0.15 + driftTilt;

        ctx.save();
        ctx.translate(carX, carY + carH / 2);
        ctx.rotate(steerAngle);
        ctx.translate(-carX, -(carY + carH / 2));

        ctx.fillStyle = "#00000060";
        ctx.fillRect(carX - carW / 2 - 3, carY - 3, carW + 6, carH + 6);

        const carGrad = ctx.createLinearGradient(carX - carW / 2, carY, carX + carW / 2, carY);
        if (isDrifting) {
          carGrad.addColorStop(0, "#FF007F");
          carGrad.addColorStop(0.5, "#FF4500");
          carGrad.addColorStop(1, "#FF007F");
        } else if (miniBoostRef.current > 0) {
          carGrad.addColorStop(0, "#FFFF00");
          carGrad.addColorStop(0.5, "#FF8800");
          carGrad.addColorStop(1, "#FFFF00");
        } else {
          carGrad.addColorStop(0, "#00FFFF");
          carGrad.addColorStop(0.5, "#0088FF");
          carGrad.addColorStop(1, "#00FFFF");
        }
        ctx.fillStyle = carGrad;
        ctx.fillRect(carX - carW / 2, carY, carW, carH);

        ctx.fillStyle = "#240046";
        ctx.fillRect(carX - carW * 0.35, carY + 2, carW * 0.7, carH * 0.35);

        ctx.fillStyle = "#FF007F";
        ctx.fillRect(carX - carW / 2, carY + carH - 5, 8, 5);
        ctx.fillRect(carX + carW / 2 - 8, carY + carH - 5, 8, 5);

        // Drift sparks
        if (isDrifting) {
          for (let sp = 0; sp < 3; sp++) {
            ctx.fillStyle = `rgba(255, ${150 + Math.random() * 105}, 0, ${0.5 + Math.random() * 0.5})`;
            const spx = carX + (driftDirRef.current > 0 ? -carW / 2 - 5 : carW / 2 + 5) + (Math.random() - 0.5) * 10;
            const spy = carY + carH - 2 + Math.random() * 8;
            ctx.fillRect(spx, spy, 3, 3);
          }
        }

        // Mini-boost flame
        if (miniBoostRef.current > 0) {
          ctx.fillStyle = "#FFFF0090";
          ctx.fillRect(carX - 8, carY + carH, 6, 10 + Math.random() * 10);
          ctx.fillRect(carX + 2, carY + carH, 6, 10 + Math.random() * 10);
        }

        ctx.restore();
      }

      // Canvas HUD
      if (stateRef.current === "playing") {
        ctx.fillStyle = "rgba(10, 0, 30, 0.7)";
        ctx.strokeStyle = "#00FFFF40";
        ctx.lineWidth = 1;
        const hudX = 10, hudY = 10, hudW = 170, hudH = 80;
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

        ctx.fillStyle = "#FFFFFF";
        ctx.font = "7px 'Press Start 2P', monospace";
        ctx.fillText(`LAP ${currentLapRef.current}/${TOTAL_LAPS}`, hudX + 10, hudY + 58);

        if (bestLapTimeRef.current !== null) {
          ctx.fillStyle = "#FFFF00";
          ctx.fillText(`BEST ${bestLapTimeRef.current.toFixed(1)}s`, hudX + 10, hudY + 72);
        }

        // Drift indicator
        if (driftStateRef.current === "drifting") {
          ctx.fillStyle = "#FF007F";
          ctx.font = "bold 10px 'Press Start 2P', monospace";
          ctx.textAlign = "center";
          ctx.fillText("🔥 DRIFT!", W / 2, 30);
          ctx.textAlign = "left";
        } else if (miniBoostRef.current > 0) {
          ctx.fillStyle = "#FFFF00";
          ctx.font = "bold 10px 'Press Start 2P', monospace";
          ctx.textAlign = "center";
          ctx.fillText("⚡ BOOST!", W / 2, 30);
          ctx.textAlign = "left";
        }

        // Off-road warning
        if (offRoadRef.current) {
          ctx.fillStyle = "#FF007F";
          ctx.font = "bold 10px 'Press Start 2P', monospace";
          ctx.textAlign = "center";
          ctx.fillText("⚠ OFF ROAD ⚠", W / 2, 50);
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
  }, [isLeft, isRight, isAccel, isBrake, isHandbrake]);

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
          <div className="flex justify-between items-center mb-1">
            <span className="text-[9px] text-muted-foreground font-pixel">LAP {currentLap}/{TOTAL_LAPS}</span>
            {bestLapTime !== null && (
              <span className="text-[9px] text-neon-yellow font-pixel">BEST {bestLapTime.toFixed(1)}s</span>
            )}
          </div>
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
            <p className="font-pixel text-[8px] text-primary neon-text-cyan mb-1">THE NEON LOOP — {TOTAL_LAPS} LAPS</p>
            <p className="font-pixel text-[7px] text-neon-yellow mb-4">HOLD TURN + SPACE TO DRIFT</p>
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
              <>
                <p className="font-pixel text-[8px] text-neon-yellow mb-1">TIME BONUS: {Math.floor(timerRef.current * 100)}</p>
                {bestLapTime !== null && (
                  <p className="font-pixel text-[8px] text-primary mb-1">BEST LAP: {bestLapTime.toFixed(2)}s</p>
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
