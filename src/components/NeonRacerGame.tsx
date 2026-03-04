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

const WIDTH = 640;
const HEIGHT = 480;

/* ── road / world constants ── */
const SEG_LENGTH = 200;       // z-length per segment
const DRAW_DISTANCE = 150;    // how many segments ahead
const ROAD_WIDTH = 2000;
const LANE_COUNT = 3;
const FOV = 100;              // field of view (focal length)
const CAM_HEIGHT = 1500;
const CAM_DEPTH = 1 / Math.tan((FOV / 2) * (Math.PI / 180));

/* ── gameplay ── */
const MAX_SPEED = SEG_LENGTH * 60;    // units/sec at 60fps → ~1 seg/frame
const ACCEL = MAX_SPEED / 120;
const BRAKE = -MAX_SPEED / 60;
const DECEL = -MAX_SPEED / 360;
const OFF_ROAD_DECEL = -MAX_SPEED / 30;
const STEER_SPEED = 3;
const CENTRIFUGAL = 0.3;
const BOOST_MULT = 2;
const BOOST_DURATION = 90;   // frames
const BOOST_COOLDOWN = 180;

const TOTAL_SEGMENTS = 6000;

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
  y: number;       // hill height
  // projected
  px: number; py: number; pw: number; pscale: number;
  clip: number;
  // sprites
  sprite?: "palm" | "car";
  spriteX?: number; // -1 to 1
}

interface EnemyCar {
  segIdx: number;
  offset: number; // -1 to 1
  speed: number;
}

function buildRoad(): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i < TOTAL_SEGMENTS; i++) {
    let curve = 0;
    let y = 0;
    // gentle curves
    if (i > 50 && i < 250) curve = 2;
    if (i > 300 && i < 500) curve = -3;
    if (i > 600 && i < 900) curve = 4;
    if (i > 1000 && i < 1200) curve = -2;
    if (i > 1400 && i < 1800) curve = 3;
    if (i > 2000 && i < 2400) curve = -5;
    if (i > 2600 && i < 3000) curve = 2.5;
    if (i > 3200 && i < 3600) curve = -4;
    if (i > 3800 && i < 4200) curve = 3;
    if (i > 4500 && i < 5000) curve = -2;
    // gentle hills
    if (i > 100 && i < 300) y = Math.sin((i - 100) / 200 * Math.PI) * 2000;
    if (i > 700 && i < 1000) y = Math.sin((i - 700) / 300 * Math.PI) * 3000;
    if (i > 1500 && i < 1700) y = Math.sin((i - 1500) / 200 * Math.PI) * 1500;
    if (i > 2200 && i < 2500) y = Math.sin((i - 2200) / 300 * Math.PI) * 2500;

    const seg: Segment = {
      z: i * SEG_LENGTH,
      curve,
      y,
      px: 0, py: 0, pw: 0, pscale: 0,
      clip: HEIGHT,
    };

    // sprinkle palms
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
  const [showSettings, setShowSettings] = useState(false);
  const [controlScheme, setControlScheme] = useState<ControlScheme>(() => {
    return (localStorage.getItem("arcade-control-scheme") as ControlScheme) || "arrows";
  });

  const stateRef = useRef<GameState>("idle");
  const keysRef = useRef<Set<string>>(new Set());
  const roadRef = useRef<Segment[]>([]);
  const posRef = useRef(0);        // z position
  const speedRef = useRef(0);
  const playerXRef = useRef(0);    // -1 to 1
  const scoreRef = useRef(0);
  const boostRef = useRef(0);      // frames remaining
  const boostCoolRef = useRef(0);
  const enemiesRef = useRef<EnemyCar[]>([]);
  const animRef = useRef(0);
  const lastTimeRef = useRef(0);

  const cycleControl = useCallback(() => {
    const order: ControlScheme[] = ["arrows", "qwerty", "azerty"];
    const idx = order.indexOf(controlScheme);
    const next = order[(idx + 1) % order.length];
    setControlScheme(next);
    localStorage.setItem("arcade-control-scheme", next);
    toast(`Controls: ${CONTROL_LABELS[next]}`);
  }, [controlScheme]);

  const isLeft = useCallback((keys: Set<string>) => {
    if (controlScheme === "arrows") return keys.has("ArrowLeft");
    if (controlScheme === "qwerty") return keys.has("a") || keys.has("A");
    return keys.has("q") || keys.has("Q");
  }, [controlScheme]);

  const isRight = useCallback((keys: Set<string>) => {
    if (controlScheme === "arrows") return keys.has("ArrowRight");
    return keys.has("d") || keys.has("D");
  }, [controlScheme]);

  const isAccel = useCallback((keys: Set<string>) => {
    if (controlScheme === "arrows") return keys.has("ArrowUp");
    if (controlScheme === "qwerty") return keys.has("w") || keys.has("W");
    return keys.has("z") || keys.has("Z");
  }, [controlScheme]);

  const isBrake = useCallback((keys: Set<string>) => {
    if (controlScheme === "arrows") return keys.has("ArrowDown");
    return keys.has("s") || keys.has("S");
  }, [controlScheme]);

  const startGame = useCallback(() => {
    roadRef.current = buildRoad();
    posRef.current = 0;
    speedRef.current = 0;
    playerXRef.current = 0;
    scoreRef.current = 0;
    boostRef.current = 0;
    boostCoolRef.current = 0;
    // spawn enemies
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

        // accel / brake
        if (isAccel(keys)) spd += ACCEL;
        else if (isBrake(keys)) spd += BRAKE;
        else spd += DECEL;

        // off road decel
        if (Math.abs(playerXRef.current) > 1) spd += OFF_ROAD_DECEL;

        spd = Math.max(0, Math.min(spd, maxSpd));
        speedRef.current = spd;

        // steering
        const steerAmt = STEER_SPEED * (spd / MAX_SPEED) * dt * 60;
        if (isLeft(keys)) playerXRef.current -= steerAmt;
        if (isRight(keys)) playerXRef.current += steerAmt;
        playerXRef.current = Math.max(-2.5, Math.min(2.5, playerXRef.current));

        // boost
        if (boostCoolRef.current > 0) boostCoolRef.current--;
        if (keys.has(" ") && boostRef.current <= 0 && boostCoolRef.current <= 0 && spd > MAX_SPEED * 0.3) {
          boostRef.current = BOOST_DURATION;
          boostCoolRef.current = BOOST_COOLDOWN;
        }
        if (boostRef.current > 0) boostRef.current--;

        // position
        posRef.current += spd * dt;

        // wrap road (infinite)
        const totalLength = TOTAL_SEGMENTS * SEG_LENGTH;
        if (posRef.current >= totalLength) posRef.current -= totalLength;

        // centrifugal force
        const baseIdx = Math.floor(posRef.current / SEG_LENGTH) % TOTAL_SEGMENTS;
        const baseSeg = road[baseIdx];
        if (baseSeg) {
          playerXRef.current += baseSeg.curve * CENTRIFUGAL * (spd / MAX_SPEED) * dt * 60;
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
              // crash
              stateRef.current = "gameover";
              setGameState("gameover");
              break;
            }
          }
          // move enemy
          e.segIdx += e.speed * dt / SEG_LENGTH;
          if (e.segIdx >= TOTAL_SEGMENTS) e.segIdx -= TOTAL_SEGMENTS;
        }
      }

      /* ── RENDER ── */
      // sky gradient
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

      // sun body
      ctx.fillStyle = COL_SUN_CENTER;
      ctx.beginPath();
      ctx.arc(W / 2, sunY, sunR, 0, Math.PI * 2);
      ctx.fill();

      // sun scanlines
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
        let dx = 0;         // cumulative curve offset
        let x = 0;

        // first pass: project all visible segments
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

        // second pass: draw back to front
        for (let n = DRAW_DISTANCE - 1; n > 0; n--) {
          const idx = (startIdx + n) % TOTAL_SEGMENTS;
          const seg = roadRef.current[idx];
          const prevIdx = (startIdx + n - 1) % TOTAL_SEGMENTS;
          const prev = roadRef.current[prevIdx];

          if (seg.pscale <= 0 || prev.pscale <= 0) continue;

          const isOdd = (Math.floor((startIdx + n) / 3) % 2) === 0;

          // grass
          const grassColor = isOdd ? COL_GRASS_DARK : COL_GRASS_LIGHT;
          ctx.fillStyle = grassColor;
          ctx.fillRect(0, prev.py, W, seg.py - prev.py);

          // rumble strips
          const rumbleW1 = prev.pw * 1.15;
          const rumbleW2 = seg.pw * 1.15;
          drawPoly(ctx, isOdd ? COL_RUMBLE_DARK : COL_RUMBLE_LIGHT,
            prev.px, prev.py, rumbleW1,
            seg.px, seg.py, rumbleW2);

          // road
          drawPoly(ctx, isOdd ? COL_ROAD_DARK : COL_ROAD_LIGHT,
            prev.px, prev.py, prev.pw,
            seg.px, seg.py, seg.pw);

          // lane markings
          if (isOdd) {
            const laneW1 = prev.pw / 20;
            const laneW2 = seg.pw / 20;
            for (let l = 1; l < LANE_COUNT; l++) {
              const lx1 = prev.px - prev.pw + (prev.pw * 2 * l / LANE_COUNT);
              const lx2 = seg.px - seg.pw + (seg.pw * 2 * l / LANE_COUNT);
              drawPoly(ctx, COL_LANE,
                lx1, prev.py, laneW1,
                lx2, seg.py, laneW2);
            }
          }

          // grid lines on grass (glow grid effect)
          if (isOdd && n < 80) {
            ctx.strokeStyle = "#00FFFF15";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, seg.py);
            ctx.lineTo(W, seg.py);
            ctx.stroke();
          }

          // sprites (palms)
          if (seg.sprite === "palm" && seg.pscale > 0) {
            const spriteScale = seg.pscale * 3000;
            const sx = seg.px + (seg.spriteX || 0) * seg.pw;
            const sy = seg.py;
            const sw = spriteScale * 0.4;
            const sh = spriteScale * 1.2;

            // trunk
            ctx.fillStyle = "#4a2060";
            ctx.fillRect(sx - sw * 0.1, sy - sh, sw * 0.2, sh);
            // leaves
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

              // car body
              ctx.fillStyle = "#FF007F";
              ctx.fillRect(cx - cw / 2, cy - ch, cw, ch);
              // windshield
              ctx.fillStyle = "#00FFFF80";
              ctx.fillRect(cx - cw * 0.3, cy - ch * 0.9, cw * 0.6, ch * 0.3);
              // headlights glow
              ctx.fillStyle = "#FFFF0060";
              ctx.fillRect(cx - cw * 0.4, cy - ch * 0.2, cw * 0.15, ch * 0.15);
              ctx.fillRect(cx + cw * 0.25, cy - ch * 0.2, cw * 0.15, ch * 0.15);
            }
          }
        }
      }

      // player car
      if (stateRef.current === "playing" || stateRef.current === "gameover") {
        const carW = 50;
        const carH = 30;
        const carX = W / 2;
        const carY = H - 60;

        // shadow
        ctx.fillStyle = "#00000060";
        ctx.fillRect(carX - carW / 2 - 3, carY - 3, carW + 6, carH + 6);

        // body
        const carGrad = ctx.createLinearGradient(carX - carW / 2, carY, carX + carW / 2, carY);
        carGrad.addColorStop(0, "#00FFFF");
        carGrad.addColorStop(0.5, "#0088FF");
        carGrad.addColorStop(1, "#00FFFF");
        ctx.fillStyle = carGrad;
        ctx.fillRect(carX - carW / 2, carY, carW, carH);

        // windshield
        ctx.fillStyle = "#240046";
        ctx.fillRect(carX - carW * 0.35, carY + 2, carW * 0.7, carH * 0.35);

        // tail lights
        ctx.fillStyle = "#FF007F";
        ctx.fillRect(carX - carW / 2, carY + carH - 5, 8, 5);
        ctx.fillRect(carX + carW / 2 - 8, carY + carH - 5, 8, 5);

        // boost visual
        if (boostRef.current > 0) {
          ctx.fillStyle = "#FF007F90";
          ctx.fillRect(carX - 8, carY + carH, 6, 10 + Math.random() * 10);
          ctx.fillRect(carX + 2, carY + carH, 6, 10 + Math.random() * 10);
          // motion blur overlay
          ctx.fillStyle = `rgba(255, 0, 127, ${0.05 + Math.random() * 0.05})`;
          ctx.fillRect(0, 0, W, H);
        }
      }

      // HUD
      if (stateRef.current === "playing") {
        // glass panel
        ctx.fillStyle = "rgba(10, 0, 30, 0.6)";
        ctx.strokeStyle = "#00FFFF40";
        ctx.lineWidth = 1;
        const hudX = 10, hudY = 10, hudW = 150, hudH = 75;
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
        ctx.fillText(`DIST ${Math.floor(posRef.current / SEG_LENGTH)}m`, hudX + 10, hudY + 60);

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

      // idle screen
      if (stateRef.current === "idle") {
        ctx.fillStyle = "rgba(10, 0, 30, 0.85)";
        ctx.fillRect(0, 0, W, H);

        ctx.font = "20px 'Press Start 2P', monospace";
        ctx.fillStyle = "#FF007F";
        ctx.textAlign = "center";
        ctx.fillText("NEON RACER", W / 2, H * 0.35);

        ctx.font = "8px 'Press Start 2P', monospace";
        ctx.fillStyle = "#00FFFF";
        ctx.fillText("PRESS ENTER TO RACE", W / 2, H * 0.5);

        ctx.fillStyle = "#FFFFFF60";
        ctx.font = "7px 'Press Start 2P', monospace";
        ctx.fillText("STEER: ← → | ACCEL: ↑ | BRAKE: ↓", W / 2, H * 0.62);
        ctx.fillText("BOOST: SPACEBAR", W / 2, H * 0.7);
        ctx.textAlign = "left";
      }

      // game over screen
      if (stateRef.current === "gameover") {
        ctx.fillStyle = "rgba(10, 0, 30, 0.8)";
        ctx.fillRect(0, 0, W, H);

        ctx.textAlign = "center";
        ctx.font = "18px 'Press Start 2P', monospace";
        ctx.fillStyle = "#FF007F";
        ctx.fillText("WRECKED", W / 2, H * 0.3);

        ctx.font = "9px 'Press Start 2P', monospace";
        ctx.fillStyle = "#00FFFF";
        ctx.fillText(`DISTANCE: ${Math.floor(posRef.current / SEG_LENGTH)}m`, W / 2, H * 0.45);
        ctx.fillText(`SCORE: ${Math.floor(scoreRef.current)}`, W / 2, H * 0.55);

        ctx.fillStyle = "#FFFFFF60";
        ctx.font = "7px 'Press Start 2P', monospace";
        ctx.fillText("PRESS ENTER TO RETRY", W / 2, H * 0.7);
        ctx.textAlign = "left";
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [isLeft, isRight, isAccel, isBrake]);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="block rounded-lg border border-border/50 neon-glow-pink max-w-full"
          style={{ imageRendering: "pixelated" }}
        />

        <button
          onClick={cycleControl}
          className="absolute top-2 right-2 glass rounded-full p-2 hover:neon-glow-cyan transition-all z-10"
          title="Change controls"
        >
          <Settings className="w-4 h-4 text-primary" />
        </button>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="glass rounded-full px-3 py-1 font-pixel text-[8px]">
          {CONTROL_LABELS[controlScheme]}
        </span>
        <span className="font-pixel text-[8px]">
          SPACE = Boost
        </span>
      </div>

      {gameState === "idle" && (
        <button
          onClick={startGame}
          className="font-pixel text-[10px] glass rounded-lg px-6 py-3 neon-glow-pink text-secondary hover:scale-105 transition-transform"
        >
          START RACE
        </button>
      )}
      {gameState === "gameover" && (
        <button
          onClick={startGame}
          className="font-pixel text-[10px] glass rounded-lg px-6 py-3 neon-glow-cyan text-primary hover:scale-105 transition-transform"
        >
          RACE AGAIN
        </button>
      )}
    </div>
  );
};

export default NeonRacerGame;
