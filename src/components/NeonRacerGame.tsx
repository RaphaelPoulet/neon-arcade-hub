import { useRef, useEffect, useState, useCallback } from "react";
import { Settings } from "lucide-react";
import { toast } from "sonner";

type ControlScheme = "arrows" | "qwerty" | "azerty";
type GameState = "idle" | "playing" | "gameover";

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
const ACCEL = MAX_SPEED / 120;
const BRAKE = -MAX_SPEED / 60;
const DECEL = -MAX_SPEED / 360;
const OFF_ROAD_DECEL = -MAX_SPEED / 30;
const STEER_SPEED = 3 * 0.6;          // reduced by 40%
const CENTRIFUGAL = 0.3;
const BOOST_MULT = 2;
const BOOST_DURATION = 90;
const BOOST_COOLDOWN = 180;
const STEER_LERP = 0.12;              // interpolation factor

const TOTAL_SEGMENTS = 6000;
const MAX_CURVE = 3.5;                // cap curve intensity

/* ── checkpoint ── */
const CHECKPOINT_INTERVAL = 2000;     // units of distance (segments)
const CHECKPOINT_TIME_ADD = 15;       // seconds added
const INITIAL_TIME = 40;              // starting seconds

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

interface Segment {
  z: number;
  curve: number;
  y: number;
  px: number; py: number; pw: number; pscale: number;
  clip: number;
  sprite?: "palm" | "car";
  spriteX?: number;
  checkpoint?: boolean;
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

function buildRoad(): Segment[] {
  const segs: Segment[] = [];
  // Define curve zones with longer transitions (50% longer)
  const curveZones: [number, number, number][] = [
    [50, 375, 2], [450, 750, -3], [900, 1350, 3],
    [1500, 1800, -2], [2100, 2700, 2.5], [3000, 3450, -3],
    [3900, 4350, 2.5], [4650, 5100, -2],
  ];

  for (let i = 0; i < TOTAL_SEGMENTS; i++) {
    let curve = 0;
    let y = 0;

    for (const [start, end, c] of curveZones) {
      if (i >= start && i < end) {
        const len = end - start;
        const rampIn = 60;  // longer ramp
        const rampOut = 60;
        let t = 1;
        if (i - start < rampIn) t = (i - start) / rampIn;
        else if (end - i < rampOut) t = (end - i) / rampOut;
        curve = Math.max(-MAX_CURVE, Math.min(MAX_CURVE, c * t));
      }
    }

    // gentle hills
    if (i > 100 && i < 300) y = Math.sin((i - 100) / 200 * Math.PI) * 2000;
    if (i > 700 && i < 1000) y = Math.sin((i - 700) / 300 * Math.PI) * 3000;
    if (i > 1500 && i < 1700) y = Math.sin((i - 1500) / 200 * Math.PI) * 1500;
    if (i > 2200 && i < 2500) y = Math.sin((i - 2200) / 300 * Math.PI) * 2500;

    const seg: Segment = {
      z: i * SEG_LENGTH,
      curve, y,
      px: 0, py: 0, pw: 0, pscale: 0,
      clip: HEIGHT,
    };

    // checkpoint gates
    if (i > 0 && i % CHECKPOINT_INTERVAL === 0) {
      seg.checkpoint = true;
    }

    // palms
    if (i % 20 === 0 && i > 10) {
      seg.sprite = "palm";
      seg.spriteX = (Math.random() > 0.5 ? 1 : -1) * (1.2 + Math.random() * 0.8);
    }

    segs.push(seg);
  }
  return segs;
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
  const [speed, setSpeed] = useState(0);
  const [distance, setDistance] = useState(0);
  const [timeLeft, setTimeLeft] = useState(INITIAL_TIME);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [controlScheme, setControlScheme] = useState<ControlScheme>(() => {
    return (localStorage.getItem("arcade-control-scheme") as ControlScheme) || "arrows";
  });

  const stateRef = useRef<GameState>("idle");
  const keysRef = useRef<Set<string>>(new Set());
  const roadRef = useRef<Segment[]>([]);
  const posRef = useRef(0);
  const speedRef = useRef(0);
  const playerXRef = useRef(0);
  const targetXRef = useRef(0);         // lerp target
  const scoreRef = useRef(0);
  const boostRef = useRef(0);
  const boostCoolRef = useRef(0);
  const enemiesRef = useRef<EnemyCar[]>([]);
  const animRef = useRef(0);
  const lastTimeRef = useRef(0);
  const timerRef = useRef(INITIAL_TIME);
  const lastCheckpointRef = useRef(0);
  const floatingTextsRef = useRef<FloatingText[]>([]);
  const controlSchemeRef = useRef(controlScheme);

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
    roadRef.current = buildRoad();
    posRef.current = 0;
    speedRef.current = 0;
    playerXRef.current = 0;
    targetXRef.current = 0;
    scoreRef.current = 0;
    boostRef.current = 0;
    boostCoolRef.current = 0;
    timerRef.current = INITIAL_TIME;
    lastCheckpointRef.current = 0;
    floatingTextsRef.current = [];
    const enemies: EnemyCar[] = [];
    for (let i = 0; i < 60; i++) {
      enemies.push({
        segIdx: 50 + Math.floor(Math.random() * (TOTAL_SEGMENTS - 200)),
        offset: -0.6 + Math.random() * 1.2,
        speed: MAX_SPEED * (0.3 + Math.random() * 0.3),
      });
    }
    enemiesRef.current = enemies;
    stateRef.current = "playing";
    setGameState("playing");
    setScore(0);
    setSpeed(0);
    setDistance(0);
    setTimeLeft(INITIAL_TIME);
  }, []);

  // input
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      keysRef.current.add(e.key);
      if (e.key === " " || e.key === "ArrowUp" || e.key === "ArrowDown" ||
          e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
      }
      if (stateRef.current === "idle" || stateRef.current === "gameover") {
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

  // game loop
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

      if (stateRef.current === "playing" && road.length > 0) {
        /* ── UPDATE ── */
        let spd = speedRef.current;
        const boosting = boostRef.current > 0;
        const maxSpd = boosting ? MAX_SPEED * BOOST_MULT : MAX_SPEED;

        if (isAccel(keys)) spd += ACCEL;
        else if (isBrake(keys)) spd += BRAKE;
        else spd += DECEL;

        if (Math.abs(playerXRef.current) > 1) spd += OFF_ROAD_DECEL;
        spd = Math.max(0, Math.min(spd, maxSpd));
        speedRef.current = spd;

        // steering with lerp
        const steerAmt = STEER_SPEED * (spd / MAX_SPEED) * dt * 60;
        if (isLeft(keys)) targetXRef.current -= steerAmt;
        if (isRight(keys)) targetXRef.current += steerAmt;
        targetXRef.current = Math.max(-2.5, Math.min(2.5, targetXRef.current));
        // smooth interpolation
        playerXRef.current += (targetXRef.current - playerXRef.current) * STEER_LERP;

        // boost
        if (boostCoolRef.current > 0) boostCoolRef.current--;
        if (keys.has(" ") && boostRef.current <= 0 && boostCoolRef.current <= 0 && spd > MAX_SPEED * 0.3) {
          boostRef.current = BOOST_DURATION;
          boostCoolRef.current = BOOST_COOLDOWN;
        }
        if (boostRef.current > 0) boostRef.current--;

        // position
        posRef.current += spd * dt;
        const totalLength = TOTAL_SEGMENTS * SEG_LENGTH;
        if (posRef.current >= totalLength) posRef.current -= totalLength;

        // centrifugal
        const baseIdx = Math.floor(posRef.current / SEG_LENGTH) % TOTAL_SEGMENTS;
        const baseSeg = road[baseIdx];
        if (baseSeg) {
          targetXRef.current += baseSeg.curve * CENTRIFUGAL * (spd / MAX_SPEED) * dt * 60;
        }

        // timer countdown
        timerRef.current -= dt;
        setTimeLeft(Math.max(0, Math.ceil(timerRef.current)));

        // checkpoint detection
        const currentDistSeg = Math.floor(posRef.current / SEG_LENGTH);
        const currentCheckpoint = Math.floor(currentDistSeg / CHECKPOINT_INTERVAL);
        if (currentCheckpoint > lastCheckpointRef.current && currentCheckpoint > 0) {
          lastCheckpointRef.current = currentCheckpoint;
          timerRef.current += CHECKPOINT_TIME_ADD;
          floatingTextsRef.current.push({
            x: W / 2, y: H * 0.3,
            text: `TIME +${CHECKPOINT_TIME_ADD}s`,
            life: 60, maxLife: 60,
          });
        }

        // time up = game over
        if (timerRef.current <= 0) {
          timerRef.current = 0;
          stateRef.current = "gameover";
          setGameState("gameover");
        }

        // score
        scoreRef.current += spd * dt * 0.01;
        setScore(Math.floor(scoreRef.current));
        setSpeed(Math.floor(spd / MAX_SPEED * 200));
        setDistance(Math.floor(posRef.current / SEG_LENGTH));

        // enemy collision
        for (const e of enemiesRef.current) {
          const eDist = (e.segIdx * SEG_LENGTH) - posRef.current;
          if (eDist > 0 && eDist < SEG_LENGTH * 2) {
            if (Math.abs(playerXRef.current - e.offset) < 0.4) {
              stateRef.current = "gameover";
              setGameState("gameover");
              break;
            }
          }
          e.segIdx += e.speed * dt / SEG_LENGTH;
          if (e.segIdx >= TOTAL_SEGMENTS) e.segIdx -= TOTAL_SEGMENTS;
        }

        // update floating texts
        floatingTextsRef.current = floatingTextsRef.current
          .map(ft => ({ ...ft, life: ft.life - 1, y: ft.y - 0.8 }))
          .filter(ft => ft.life > 0);
      }

      /* ── RENDER ── */
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H / 2);
      skyGrad.addColorStop(0, COL_SKY_TOP);
      skyGrad.addColorStop(1, COL_SKY_BOT);
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H);

      // sun
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

      // mountains
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

      // road rendering
      if (roadRef.current.length > 0) {
        const camZ = posRef.current;
        const startIdx = Math.floor(camZ / SEG_LENGTH);
        let maxy = H;
        let dx = 0;
        let x = 0;

        for (let n = 0; n < DRAW_DISTANCE; n++) {
          const idx = (startIdx + n) % TOTAL_SEGMENTS;
          const seg = roadRef.current[idx];
          const looped = (startIdx + n >= TOTAL_SEGMENTS);
          const segZ = seg.z + (looped ? TOTAL_SEGMENTS * SEG_LENGTH : 0);

          project(seg, playerXRef.current * ROAD_WIDTH / 2 - x, CAM_HEIGHT + seg.y, camZ, W, H);

          x += dx;
          dx += seg.curve * seg.pscale;

          seg.px += x;
          seg.clip = maxy;
          if (seg.py < maxy) maxy = seg.py;
        }

        for (let n = DRAW_DISTANCE - 1; n > 0; n--) {
          const idx = (startIdx + n) % TOTAL_SEGMENTS;
          const seg = roadRef.current[idx];
          const prevIdx = (startIdx + n - 1) % TOTAL_SEGMENTS;
          const prev = roadRef.current[prevIdx];

          if (seg.pscale <= 0 || prev.pscale <= 0) continue;

          const isOdd = (Math.floor((startIdx + n) / 3) % 2) === 0;

          // grass
          ctx.fillStyle = isOdd ? COL_GRASS_DARK : COL_GRASS_LIGHT;
          ctx.fillRect(0, prev.py, W, seg.py - prev.py);

          // rumble
          drawPoly(ctx, isOdd ? COL_RUMBLE_DARK : COL_RUMBLE_LIGHT,
            prev.px, prev.py, prev.pw * 1.15,
            seg.px, seg.py, seg.pw * 1.15);

          // road
          drawPoly(ctx, isOdd ? COL_ROAD_DARK : COL_ROAD_LIGHT,
            prev.px, prev.py, prev.pw,
            seg.px, seg.py, seg.pw);

          // lanes
          if (isOdd) {
            const laneW1 = prev.pw / 20;
            const laneW2 = seg.pw / 20;
            for (let l = 1; l < LANE_COUNT; l++) {
              const lx1 = prev.px - prev.pw + (prev.pw * 2 * l / LANE_COUNT);
              const lx2 = seg.px - seg.pw + (seg.pw * 2 * l / LANE_COUNT);
              drawPoly(ctx, COL_LANE, lx1, prev.py, laneW1, lx2, seg.py, laneW2);
            }
          }

          // grid lines
          if (isOdd && n < 80) {
            ctx.strokeStyle = "#00FFFF15";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, seg.py);
            ctx.lineTo(W, seg.py);
            ctx.stroke();
          }

          // checkpoint gate
          if (seg.checkpoint && seg.pscale > 0 && n < 100) {
            const gateW = seg.pw * 1.3;
            const gateH = seg.pscale * 4000;
            const gx = seg.px;
            const gy = seg.py;
            // pillars
            ctx.fillStyle = "#00FFFF80";
            ctx.fillRect(gx - gateW - 4, gy - gateH, 8, gateH);
            ctx.fillRect(gx + gateW - 4, gy - gateH, 8, gateH);
            // top bar
            ctx.fillStyle = "#FF007F90";
            ctx.fillRect(gx - gateW, gy - gateH, gateW * 2, 6);
            // glow
            ctx.shadowColor = "#00FFFF";
            ctx.shadowBlur = 15;
            ctx.fillStyle = "#00FFFF40";
            ctx.fillRect(gx - gateW, gy - gateH - 2, gateW * 2, 3);
            ctx.shadowBlur = 0;
          }

          // palms
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

          // enemy cars
          for (const e of enemiesRef.current) {
            const eIdx = Math.floor(e.segIdx) % TOTAL_SEGMENTS;
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

      // speed blur effect at edges
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

      // player car
      if (stateRef.current === "playing" || stateRef.current === "gameover") {
        const carW = 50;
        const carH = 30;
        const carX = W / 2;
        const carY = H - 60;

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
          ctx.fillStyle = `rgba(255, 0, 127, ${0.05 + Math.random() * 0.05})`;
          ctx.fillRect(0, 0, W, H);
        }
      }

      // HUD
      if (stateRef.current === "playing") {
        ctx.fillStyle = "rgba(10, 0, 30, 0.6)";
        ctx.strokeStyle = "#00FFFF40";
        ctx.lineWidth = 1;
        const hudX = 10, hudY = 10, hudW = 150, hudH = 90;
        ctx.beginPath();
        ctx.roundRect(hudX, hudY, hudW, hudH, 8);
        ctx.fill();
        ctx.stroke();

        ctx.font = "bold 10px 'Press Start 2P', monospace";
        ctx.fillStyle = "#00FFFF";
        ctx.fillText(`${Math.floor(speedRef.current / MAX_SPEED * 200)} MPH`, hudX + 10, hudY + 22);
        ctx.fillStyle = "#FF007F";
        ctx.fillText(`SCORE ${Math.floor(scoreRef.current)}`, hudX + 10, hudY + 42);
        ctx.fillStyle = "#FFFFFF80";
        ctx.font = "8px 'Press Start 2P', monospace";
        ctx.fillText(`DIST ${Math.floor(posRef.current / SEG_LENGTH)}m`, hudX + 10, hudY + 58);

        // timer
        const tColor = timerRef.current < 10 ? "#FF007F" : "#FFFF00";
        ctx.fillStyle = tColor;
        ctx.font = "bold 10px 'Press Start 2P', monospace";
        ctx.fillText(`TIME ${Math.ceil(timerRef.current)}s`, hudX + 10, hudY + 78);

        // boost indicator
        if (boostCoolRef.current <= 0) {
          ctx.fillStyle = "#FFFF00";
          ctx.font = "7px 'Press Start 2P', monospace";
          ctx.fillText("BOOST READY", W - 120, 25);
        } else if (boostRef.current > 0) {
          ctx.fillStyle = "#FF007F";
          ctx.font = "7px 'Press Start 2P', monospace";
          ctx.fillText("BOOST!", W - 80, 25);
        }
      }

      // floating texts
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

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [isLeft, isRight, isAccel, isBrake]);

  const schemes: ControlScheme[] = ["arrows", "qwerty", "azerty"];

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-[680px] mx-auto px-4">
      {/* Score Bar + Settings */}
      <div className="flex items-center justify-between w-full max-w-[640px]">
        <div className="glass rounded-lg px-4 py-2">
          <span className="text-[10px] text-muted-foreground block">SCORE</span>
          <span className="font-pixel text-sm text-primary neon-text-cyan">{score}</span>
        </div>

        {/* Settings Gear + Modal */}
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
            <h2 className="font-pixel text-sm text-secondary neon-text-pink mb-4">NEON RACER</h2>
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
        {gameState === "gameover" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center glass rounded-lg">
            <h2 className="font-pixel text-sm text-secondary neon-text-pink mb-2">
              {timerRef.current <= 0 ? "TIME'S UP" : "WRECKED"}
            </h2>
            <p className="font-pixel text-xs text-primary neon-text-cyan mb-1">{distance}m</p>
            <p className="font-pixel text-xs text-primary neon-text-cyan mb-6">{score} PTS</p>
            <button
              onClick={startGame}
              className="bg-secondary text-secondary-foreground font-pixel text-[10px] px-6 py-3 rounded-lg neon-glow-pink hover:scale-105 active:scale-95 transition-transform"
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
