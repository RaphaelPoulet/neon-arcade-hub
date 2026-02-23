import { useRef, useEffect, useState, useCallback } from "react";
import { Settings } from "lucide-react";
import { toast } from "sonner";

// --- Types ---
type Direction = "LEFT" | "RIGHT";
type GameState = "idle" | "playing" | "paused" | "gameover" | "waveComplete" | "bossWave";
type ControlScheme = "arrows" | "qwerty" | "azerty";

interface Point { x: number; y: number; }
interface Bullet extends Point { speed: number; }
interface Alien {
  x: number; y: number;
  width: number; height: number;
  row: number; alive: boolean;
  bobOffset: number;
}
interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  color: string; size: number;
}
interface Boss {
  x: number; y: number;
  width: number; height: number;
  hp: number; maxHp: number;
  alive: boolean;
  dir: number;
  shootTimer: number;
}

// --- Constants ---
const WIDTH = 440;
const HEIGHT = 520;
const PLAYER_W = 32;
const PLAYER_H = 20;
const PLAYER_SPEED = 5;
const PLAYER_BULLET_SPEED = 8;
const ALIEN_BULLET_SPEED = 3;
const ALIEN_COLS = 11;
const ALIEN_ROWS = 5;
const ALIEN_W = 28;
const ALIEN_H = 20;
const ALIEN_PAD_X = 8;
const ALIEN_PAD_Y = 10;
const ALIEN_START_Y = 50;
const INVULNERABLE_MS = 2000;

const ROW_SCORES = [50, 40, 30, 20, 10]; // top to bottom

const CONTROL_MAPS: Record<ControlScheme, { left: string[]; right: string[]; fire: string[] }> = {
  arrows: { left: ["ArrowLeft"], right: ["ArrowRight"], fire: ["ArrowUp", " "] },
  qwerty: { left: ["a", "A"], right: ["d", "D"], fire: ["w", "W", " "] },
  azerty: { left: ["q", "Q"], right: ["d", "D"], fire: ["z", "Z", " "] },
};

const CONTROL_LABELS: Record<ControlScheme, string> = {
  arrows: "Arrows",
  qwerty: "WASD",
  azerty: "ZQSD",
};

const SCHEME_HINT: Record<ControlScheme, string> = {
  arrows: "← → to move, ↑ or Space to fire",
  qwerty: "A/D to move, W or Space to fire",
  azerty: "Q/D to move, Z or Space to fire",
};

// --- Helpers ---
function createAlienGrid(wave: number): Alien[] {
  const aliens: Alien[] = [];
  const offsetY = Math.min(wave * 3, 30);
  for (let r = 0; r < ALIEN_ROWS; r++) {
    for (let c = 0; c < ALIEN_COLS; c++) {
      aliens.push({
        x: 30 + c * (ALIEN_W + ALIEN_PAD_X),
        y: ALIEN_START_Y + offsetY + r * (ALIEN_H + ALIEN_PAD_Y),
        width: ALIEN_W,
        height: ALIEN_H,
        row: r,
        alive: true,
        bobOffset: Math.random() * Math.PI * 2,
      });
    }
  }
  return aliens;
}

function createBoss(wave: number): Boss {
  return {
    x: WIDTH / 2 - 40,
    y: 60,
    width: 80,
    height: 36,
    hp: 10 + wave * 2,
    maxHp: 10 + wave * 2,
    alive: true,
    dir: 1,
    shootTimer: 0,
  };
}

function aabb(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// --- Component ---
const VoidInvadersGame = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loopRef = useRef(0);

  const [controlScheme, setControlScheme] = useState<ControlScheme>(() => {
    const stored = localStorage.getItem("arcade-control-scheme");
    return (stored as ControlScheme) || "arrows";
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const controlRef = useRef(controlScheme);

  const [gameState, setGameState] = useState<GameState>("idle");
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [wave, setWave] = useState(1);
  const [best, setBest] = useState(() => {
    const s = localStorage.getItem("void-invaders-best");
    return s ? parseInt(s, 10) : 0;
  });
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // All mutable game state lives in refs for the loop
  const stateRef = useRef<GameState>("idle");
  const scoreRef = useRef(0);
  const livesRef = useRef(3);
  const waveRef = useRef(1);
  const playerXRef = useRef(WIDTH / 2 - PLAYER_W / 2);
  const playerBulletsRef = useRef<Bullet[]>([]);
  const alienBulletsRef = useRef<Bullet[]>([]);
  const aliensRef = useRef<Alien[]>([]);
  const bossRef = useRef<Boss | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const keysRef = useRef<Set<string>>(new Set());
  const invulnRef = useRef(0); // timestamp when invulnerability ends
  const alienDirRef = useRef(1); // 1 = right, -1 = left
  const alienSpeedRef = useRef(0.5);
  const alienShootTimerRef = useRef(0);
  const waveCompleteTimerRef = useRef(0);
  const bestRef = useRef(best);

  useEffect(() => { setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0); }, []);
  useEffect(() => { stateRef.current = gameState; }, [gameState]);
  useEffect(() => { controlRef.current = controlScheme; }, [controlScheme]);
  useEffect(() => { bestRef.current = best; }, [best]);

  const handleSchemeChange = useCallback((scheme: ControlScheme) => {
    setControlScheme(scheme);
    localStorage.setItem("arcade-control-scheme", scheme);
    setSettingsOpen(false);
    toast(`Controls set to ${CONTROL_LABELS[scheme]}`, { duration: 2000, className: "font-pixel" });
  }, []);

  const spawnParticles = useCallback((x: number, y: number, color: string, count = 8) => {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const speed = 1 + Math.random() * 3;
      particlesRef.current.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1, maxLife: 1,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }, []);

  const initWave = useCallback((waveNum: number) => {
    const isBoss = waveNum % 5 === 0;
    if (isBoss) {
      aliensRef.current = [];
      bossRef.current = createBoss(waveNum);
    } else {
      aliensRef.current = createAlienGrid(waveNum);
      bossRef.current = null;
    }
    alienDirRef.current = 1;
    // Wave 1 base speed is gentle (0.35), ramps ~8% per wave
    alienSpeedRef.current = 0.35 + waveNum * 0.08;
    alienShootTimerRef.current = 0;
    playerBulletsRef.current = [];
    alienBulletsRef.current = [];
    playerXRef.current = WIDTH / 2 - PLAYER_W / 2;
  }, []);

  const startGame = useCallback(() => {
    scoreRef.current = 0;
    livesRef.current = 3;
    waveRef.current = 1;
    invulnRef.current = 0;
    particlesRef.current = [];
    setScore(0);
    setLives(3);
    setWave(1);
    initWave(1);
    setGameState("playing");
  }, [initWave]);

  const togglePause = useCallback(() => {
    setGameState(s => s === "playing" ? "paused" : s === "paused" ? "playing" : s);
  }, []);

  const endGame = useCallback(() => {
    setGameState("gameover");
    const s = scoreRef.current;
    if (s > bestRef.current) {
      setBest(s);
      localStorage.setItem("void-invaders-best", String(s));
    }
  }, []);

  // Key handlers
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keysRef.current.add(e.key);
      const map = CONTROL_MAPS[controlRef.current];
      if ([...map.left, ...map.right, ...map.fire].includes(e.key)) e.preventDefault();
      if (e.key === "Escape") { e.preventDefault(); if (stateRef.current === "playing" || stateRef.current === "paused") togglePause(); }
      if (e.key === "Enter" && (stateRef.current === "idle" || stateRef.current === "gameover")) startGame();
    };
    const up = (e: KeyboardEvent) => { keysRef.current.delete(e.key); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [togglePause, startGame]);

  // Main game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let lastTime = 0;

    const loop = (timestamp: number) => {
      loopRef.current = requestAnimationFrame(loop);
      const dt = Math.min((timestamp - lastTime) / 16.667, 3); // normalize to ~60fps
      lastTime = timestamp;

      const state = stateRef.current;

      // --- UPDATE ---
      if (state === "playing") {
        const map = CONTROL_MAPS[controlRef.current];
        const keys = keysRef.current;

        // Player movement
        const moveLeft = map.left.some(k => keys.has(k));
        const moveRight = map.right.some(k => keys.has(k));
        if (moveLeft) playerXRef.current = Math.max(0, playerXRef.current - PLAYER_SPEED * dt);
        if (moveRight) playerXRef.current = Math.min(WIDTH - PLAYER_W, playerXRef.current + PLAYER_SPEED * dt);

        // Player fire (single bullet)
        const wantFire = map.fire.some(k => keys.has(k));
        if (wantFire && playerBulletsRef.current.length === 0) {
          playerBulletsRef.current.push({
            x: playerXRef.current + PLAYER_W / 2 - 2,
            y: HEIGHT - 40,
            speed: PLAYER_BULLET_SPEED,
          });
        }

        // Move player bullets
        playerBulletsRef.current = playerBulletsRef.current.filter(b => {
          b.y -= b.speed * dt;
          return b.y > -10;
        });

        // Move alien bullets
        alienBulletsRef.current = alienBulletsRef.current.filter(b => {
          b.y += b.speed * dt;
          return b.y < HEIGHT + 10;
        });

        // --- Boss logic ---
        const boss = bossRef.current;
        if (boss && boss.alive) {
          boss.x += boss.dir * (1.5 + waveRef.current * 0.1) * dt;
          if (boss.x <= 0) { boss.dir = 1; }
          if (boss.x + boss.width >= WIDTH) { boss.dir = -1; }

          boss.shootTimer += dt;
          if (boss.shootTimer > 30) {
            boss.shootTimer = 0;
            // Boss fires 3 bullets in a spread
            for (let i = -1; i <= 1; i++) {
              alienBulletsRef.current.push({
                x: boss.x + boss.width / 2 + i * 15,
                y: boss.y + boss.height,
                speed: ALIEN_BULLET_SPEED + 1,
              });
            }
          }

          // Player bullets hit boss
          playerBulletsRef.current = playerBulletsRef.current.filter(b => {
            if (aabb(b.x, b.y, 4, 8, boss.x, boss.y, boss.width, boss.height)) {
              boss.hp--;
              spawnParticles(b.x, b.y, "hsl(330, 100%, 60%)", 4);
              scoreRef.current += 200;
              setScore(scoreRef.current);
              if (boss.hp <= 0) {
                boss.alive = false;
                spawnParticles(boss.x + boss.width / 2, boss.y + boss.height / 2, "hsl(280, 100%, 60%)", 20);
                scoreRef.current += 1000;
                setScore(scoreRef.current);
                // Wave complete
                waveCompleteTimerRef.current = timestamp + 2000;
                const nextWave = waveRef.current + 1;
                waveRef.current = nextWave;
                setWave(nextWave);
                setGameState("waveComplete");
              }
              return false;
            }
            return true;
          });
        }

        // --- Alien grid logic ---
        const aliens = aliensRef.current;
        const aliveAliens = aliens.filter(a => a.alive);

        if (aliveAliens.length > 0) {
          // Intra-wave speedup: multiplier of current wave's base speed
          const totalAliens = ALIEN_ROWS * ALIEN_COLS;
          const killed = totalAliens - aliveAliens.length;
          const killRatio = killed / totalAliens;
          const speedMult = 1 + killRatio * 3; // gentler curve (was *4)
          const moveSpeed = alienSpeedRef.current * speedMult * dt;

          // Move horizontally
          let hitEdge = false;
          for (const a of aliveAliens) {
            if ((a.x + a.width + moveSpeed * alienDirRef.current > WIDTH) ||
                (a.x + moveSpeed * alienDirRef.current < 0)) {
              hitEdge = true;
              break;
            }
          }

          if (hitEdge) {
            alienDirRef.current *= -1;
            // Vertical descent: starts small, grows ~7% per wave
            const baseDrop = 5;
            const waveDrop = baseDrop * (1 + waveRef.current * 0.07);
            const dropDistance = Math.min(waveDrop, 18); // cap so it never teleports
            for (const a of aliveAliens) {
              a.y += dropDistance;
            }
          } else {
            for (const a of aliveAliens) {
              a.x += moveSpeed * alienDirRef.current;
            }
          }

          // Bob animation
          for (const a of aliveAliens) {
            a.bobOffset += 0.03 * dt;
          }

          // Alien shooting
          alienShootTimerRef.current += dt;
          const shootInterval = Math.max(20, 60 - waveRef.current * 3 - killed * 0.5);
          if (alienShootTimerRef.current > shootInterval) {
            alienShootTimerRef.current = 0;
            const shooter = aliveAliens[Math.floor(Math.random() * aliveAliens.length)];
            alienBulletsRef.current.push({
              x: shooter.x + shooter.width / 2,
              y: shooter.y + shooter.height,
              speed: ALIEN_BULLET_SPEED + waveRef.current * 0.2,
            });
          }

          // Check if aliens reached bottom
          for (const a of aliveAliens) {
            if (a.y + a.height >= HEIGHT - 40) {
              endGame();
              return;
            }
          }

          // Player bullets hit aliens
          playerBulletsRef.current = playerBulletsRef.current.filter(b => {
            for (const a of aliveAliens) {
              if (aabb(b.x, b.y, 4, 8, a.x, a.y, a.width, a.height)) {
                a.alive = false;
                scoreRef.current += ROW_SCORES[a.row];
                setScore(scoreRef.current);
                spawnParticles(a.x + a.width / 2, a.y + a.height / 2, a.row < 2 ? "hsl(330, 100%, 60%)" : "hsl(280, 80%, 60%)", 8);
                return false;
              }
            }
            return true;
          });

          // Check wave complete
          if (aliens.filter(a => a.alive).length === 0) {
            waveCompleteTimerRef.current = timestamp + 2000;
            const nextWave = waveRef.current + 1;
            waveRef.current = nextWave;
            setWave(nextWave);
            setGameState("waveComplete");
          }
        }

        // Alien bullets hit player
        const px = playerXRef.current;
        const py = HEIGHT - 35;
        const isInvuln = timestamp < invulnRef.current;
        if (!isInvuln) {
          alienBulletsRef.current = alienBulletsRef.current.filter(b => {
            if (aabb(b.x - 2, b.y - 4, 4, 8, px, py, PLAYER_W, PLAYER_H)) {
              livesRef.current--;
              setLives(livesRef.current);
              spawnParticles(px + PLAYER_W / 2, py + PLAYER_H / 2, "hsl(190, 100%, 50%)", 12);
              playerXRef.current = WIDTH / 2 - PLAYER_W / 2;
              invulnRef.current = timestamp + INVULNERABLE_MS;
              if (livesRef.current <= 0) {
                endGame();
              }
              return false;
            }
            return true;
          });
        }

        // Update particles
        particlesRef.current = particlesRef.current.filter(p => {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life -= 0.02 * dt;
          return p.life > 0;
        });
      }

      // Wave complete timer
      if (state === "waveComplete" && timestamp > waveCompleteTimerRef.current) {
        initWave(waveRef.current);
        setGameState("playing");
      }

      // --- DRAW ---
      ctx.fillStyle = "hsl(230, 25%, 7%)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      // Grid
      ctx.strokeStyle = "hsla(230, 20%, 18%, 0.3)";
      ctx.lineWidth = 0.5;
      for (let x = 0; x <= WIDTH; x += 20) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, HEIGHT); ctx.stroke();
      }
      for (let y = 0; y <= HEIGHT; y += 20) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WIDTH, y); ctx.stroke();
      }

      // Draw aliens
      for (const a of aliensRef.current) {
        if (!a.alive) continue;
        const bob = Math.sin(a.bobOffset) * 2;
        ctx.save();
        if (a.row < 2) {
          // Hot pink small invaders
          ctx.shadowColor = "hsl(330, 100%, 60%)";
          ctx.shadowBlur = 10;
          ctx.fillStyle = "hsl(330, 100%, 60%)";
          const cx = a.x + a.width / 2;
          const cy = a.y + a.height / 2 + bob;
          ctx.beginPath();
          ctx.moveTo(cx, cy - 8);
          ctx.lineTo(cx + 12, cy + 4);
          ctx.lineTo(cx + 8, cy + 8);
          ctx.lineTo(cx - 8, cy + 8);
          ctx.lineTo(cx - 12, cy + 4);
          ctx.closePath();
          ctx.fill();
        } else {
          // Purple larger invaders
          ctx.shadowColor = "hsl(280, 80%, 60%)";
          ctx.shadowBlur = 10;
          ctx.fillStyle = "hsl(280, 80%, 60%)";
          const cx = a.x + a.width / 2;
          const cy = a.y + a.height / 2 + bob;
          ctx.fillRect(cx - 12, cy - 7, 24, 14);
          // "antennae"
          ctx.fillRect(cx - 10, cy - 10, 4, 4);
          ctx.fillRect(cx + 6, cy - 10, 4, 4);
        }
        ctx.restore();
      }

      // Draw boss
      const boss = bossRef.current;
      if (boss && boss.alive) {
        ctx.save();
        ctx.shadowColor = "hsl(280, 100%, 60%)";
        ctx.shadowBlur = 20;
        const pulse = 0.7 + 0.3 * Math.sin(timestamp * 0.004);
        ctx.fillStyle = `hsla(280, 100%, 60%, ${pulse})`;
        // Boss shape: big angular ship
        const cx = boss.x + boss.width / 2;
        const cy = boss.y + boss.height / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 18);
        ctx.lineTo(cx + 40, cy + 8);
        ctx.lineTo(cx + 30, cy + 18);
        ctx.lineTo(cx - 30, cy + 18);
        ctx.lineTo(cx - 40, cy + 8);
        ctx.closePath();
        ctx.fill();
        // HP bar
        ctx.shadowBlur = 0;
        ctx.fillStyle = "hsla(0, 0%, 100%, 0.2)";
        ctx.fillRect(boss.x, boss.y - 10, boss.width, 4);
        ctx.fillStyle = "hsl(330, 100%, 60%)";
        ctx.fillRect(boss.x, boss.y - 10, boss.width * (boss.hp / boss.maxHp), 4);
        ctx.restore();
      }

      // Draw player bullets (blue lasers)
      ctx.save();
      ctx.shadowColor = "hsl(190, 100%, 50%)";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "hsl(190, 100%, 70%)";
      for (const b of playerBulletsRef.current) {
        ctx.fillRect(b.x, b.y, 4, 8);
      }
      ctx.restore();

      // Draw alien bullets (pink jagged)
      ctx.save();
      ctx.shadowColor = "hsl(330, 100%, 60%)";
      ctx.shadowBlur = 8;
      ctx.fillStyle = "hsl(330, 100%, 65%)";
      for (const b of alienBulletsRef.current) {
        ctx.beginPath();
        ctx.moveTo(b.x, b.y - 4);
        ctx.lineTo(b.x + 3, b.y);
        ctx.lineTo(b.x, b.y + 4);
        ctx.lineTo(b.x - 3, b.y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // Draw player
      const isInvuln = timestamp < invulnRef.current;
      const showPlayer = !isInvuln || Math.floor(timestamp / 100) % 2 === 0;
      if (showPlayer && (state === "playing" || state === "paused")) {
        const px = playerXRef.current;
        const py = HEIGHT - 35;
        ctx.save();
        ctx.shadowColor = "hsl(190, 100%, 50%)";
        ctx.shadowBlur = 15;
        ctx.fillStyle = "hsl(190, 100%, 50%)";
        ctx.beginPath();
        ctx.moveTo(px + PLAYER_W / 2, py);
        ctx.lineTo(px + PLAYER_W, py + PLAYER_H);
        ctx.lineTo(px, py + PLAYER_H);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Draw particles
      for (const p of particlesRef.current) {
        ctx.save();
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        ctx.restore();
      }

      // Border
      ctx.save();
      ctx.shadowColor = "hsl(190, 100%, 50%)";
      ctx.shadowBlur = 8;
      ctx.strokeStyle = "hsla(190, 100%, 50%, 0.3)";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, WIDTH - 2, HEIGHT - 2);
      ctx.restore();
    };

    loopRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(loopRef.current);
  }, [endGame, initWave, spawnParticles]);

  // Touch controls
  const touchMove = useCallback((dir: "LEFT" | "RIGHT") => (e: React.TouchEvent) => {
    e.preventDefault();
    if (dir === "LEFT") keysRef.current.add(CONTROL_MAPS[controlRef.current].left[0]);
    else keysRef.current.add(CONTROL_MAPS[controlRef.current].right[0]);
  }, []);

  const touchEnd = useCallback(() => {
    const map = CONTROL_MAPS[controlRef.current];
    map.left.forEach(k => keysRef.current.delete(k));
    map.right.forEach(k => keysRef.current.delete(k));
    map.fire.forEach(k => keysRef.current.delete(k));
  }, []);

  const touchFire = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    keysRef.current.add(CONTROL_MAPS[controlRef.current].fire[0]);
    setTimeout(() => keysRef.current.delete(CONTROL_MAPS[controlRef.current].fire[0]), 100);
  }, []);

  const schemes: ControlScheme[] = ["arrows", "qwerty", "azerty"];

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-[480px] mx-auto px-4">
      {/* HUD */}
      <div className="flex items-center justify-between w-full max-w-[440px]">
        <div className="glass rounded-lg px-4 py-2">
          <span className="text-[10px] text-muted-foreground block">SCORE</span>
          <span className="font-pixel text-sm text-primary neon-text-cyan">{score}</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="glass rounded-lg px-3 py-2 text-center">
            <span className="text-[10px] text-muted-foreground block">WAVE</span>
            <span className="font-pixel text-sm text-neon-yellow">{wave}</span>
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
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="glass rounded-lg px-4 py-2 text-right">
          <span className="text-[10px] text-muted-foreground block">LIVES</span>
          <span className="font-pixel text-sm text-secondary neon-text-pink">
            {"♥".repeat(lives)}{"♡".repeat(Math.max(0, 3 - lives))}
          </span>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative" style={{ width: WIDTH, height: HEIGHT }}>
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="rounded-lg block"
          style={{ imageRendering: "pixelated" }}
        />

        {/* Overlays */}
        {gameState === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center glass rounded-lg">
            <h2 className="font-pixel text-sm text-secondary neon-text-pink mb-4">VOID INVADERS</h2>
            <p className="text-muted-foreground text-sm mb-2 text-center px-4">
              {SCHEME_HINT[controlScheme]}
            </p>
            <p className="text-muted-foreground text-xs mb-6 text-center px-4 opacity-60">
              Boss every 5th wave
            </p>
            <button
              onClick={startGame}
              className="bg-secondary text-secondary-foreground font-pixel text-[10px] px-6 py-3 rounded-lg neon-glow-pink hover:scale-105 active:scale-95 transition-transform"
            >
              INSERT COIN
            </button>
          </div>
        )}

        {gameState === "paused" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center glass rounded-lg">
            <h2 className="font-pixel text-sm text-neon-yellow mb-4">PAUSED</h2>
            <button
              onClick={togglePause}
              className="bg-primary text-primary-foreground font-pixel text-[10px] px-6 py-3 rounded-lg neon-glow-cyan hover:scale-105 active:scale-95 transition-transform"
            >
              RESUME
            </button>
          </div>
        )}

        {gameState === "waveComplete" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center glass rounded-lg">
            <h2 className="font-pixel text-sm text-primary neon-text-cyan mb-2">
              {wave % 5 === 1 && wave > 1 ? "BOSS DEFEATED!" : "WAVE CLEARED!"}
            </h2>
            <p className="font-pixel text-xs text-neon-yellow animate-pulse-neon">
              WAVE {wave} INCOMING...
            </p>
          </div>
        )}

        {gameState === "gameover" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center glass rounded-lg">
            <h2 className="font-pixel text-sm text-secondary neon-text-pink mb-2">GAME OVER</h2>
            {score >= best && score > 0 && (
              <p className="font-pixel text-[10px] text-neon-yellow animate-pulse-neon mb-2">
                🏆 NEW RECORD!
              </p>
            )}
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

      {/* Best score */}
      <div className="glass rounded-lg px-4 py-2 text-center">
        <span className="text-[10px] text-muted-foreground">BEST: </span>
        <span className="font-pixel text-sm text-neon-yellow">{best}</span>
      </div>

      {/* Pause button */}
      {gameState === "playing" && (
        <button
          onClick={togglePause}
          className="glass rounded-lg px-4 py-2 font-pixel text-[10px] text-muted-foreground hover:text-primary transition-colors"
        >
          PAUSE (ESC)
        </button>
      )}

      {/* Mobile controls */}
      {isTouchDevice && gameState === "playing" && (
        <div className="flex items-center gap-4 mt-2 select-none" style={{ touchAction: "none" }}>
          <button
            onTouchStart={touchMove("LEFT")}
            onTouchEnd={touchEnd}
            className="glass rounded-lg p-5 text-primary active:neon-glow-cyan"
          >
            <span className="font-pixel text-sm">◀</span>
          </button>
          <button
            onTouchStart={touchFire}
            className="glass rounded-lg px-8 py-5 text-secondary active:neon-glow-pink"
          >
            <span className="font-pixel text-sm">FIRE</span>
          </button>
          <button
            onTouchStart={touchMove("RIGHT")}
            onTouchEnd={touchEnd}
            className="glass rounded-lg p-5 text-primary active:neon-glow-cyan"
          >
            <span className="font-pixel text-sm">▶</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default VoidInvadersGame;
