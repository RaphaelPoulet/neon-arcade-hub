import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { TankBody } from "./WipScene";

// ---------------------------------------------------------------------------
// Figure-8 circuit ("Neon City 8")
// Centerline is a lemniscate; one branch rises into an overpass that crosses
// cleanly above the other branch at the middle of the 8.
// ---------------------------------------------------------------------------
const AX = 170; // x amplitude
const BZ = 300; // z amplitude factor (actual z range = BZ/2)
const ROAD_HALF = 9;
const SAMPLES = 1400;
const BRIDGE_H = 9.5;
const BRIDGE_W = 0.55; // param half-width of the elevated section (radians)

const NEON_CYAN = "#22d3ee";
const NEON_PINK = "#ec4899";
const NEON_PURPLE = "#a855f7";

function heightAt(t: number) {
  // bump centered on t = PI (the branch that goes over)
  let u = (t - Math.PI) / BRIDGE_W;
  if (Math.abs(u) >= 1) return 0;
  return BRIDGE_H * 0.5 * (1 + Math.cos(Math.PI * u));
}

function pointAt(t: number, out = new THREE.Vector3()) {
  return out.set(AX * Math.sin(t), heightAt(t), (BZ / 2) * Math.sin(2 * t));
}

type Sample = { p: THREE.Vector3; n: THREE.Vector3 }; // n = lateral (right) unit vector in XZ

function buildSamples(): Sample[] {
  const arr: Sample[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i < SAMPLES; i++) {
    const t = (i / SAMPLES) * Math.PI * 2;
    const p = pointAt(t).clone();
    pointAt(t - 0.002, a);
    pointAt(t + 0.002, b);
    const tan = b.clone().sub(a);
    tan.y = 0;
    tan.normalize();
    const n = new THREE.Vector3(tan.z, 0, -tan.x);
    arr.push({ p, n });
  }
  return arr;
}

function ribbon(samples: Sample[], inner: number, outer: number, yOff: number) {
  const g = new THREE.BufferGeometry();
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = samples.length;
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    pos.push(
      s.p.x + s.n.x * inner,
      s.p.y + yOff,
      s.p.z + s.n.z * inner,
      s.p.x + s.n.x * outer,
      s.p.y + yOff,
      s.p.z + s.n.z * outer,
    );
    uv.push(0, i / 12, 1, i / 12);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// vertical wall strip following the samples between i0..i1 at lateral offset
function barrier(samples: Sample[], i0: number, i1: number, off: number, yBase: number, h: number) {
  const g = new THREE.BufferGeometry();
  const pos: number[] = [];
  const idx: number[] = [];
  let n = 0;
  for (let i = i0; i <= i1; i++) {
    const s = samples[(i + samples.length) % samples.length];
    const x = s.p.x + s.n.x * off;
    const z = s.p.z + s.n.z * off;
    pos.push(x, s.p.y + yBase, z, x, s.p.y + yBase + h, z);
    n++;
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    const b = (i + 1) * 2;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function gridTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#140b26";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4000; i++) {
    const v = 20 + Math.random() * 26;
    ctx.fillStyle = `rgba(${v},${v * 0.7},${v * 1.6},0.6)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  ctx.strokeStyle = "rgba(120,60,200,0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 256, 256);
  ctx.strokeStyle = "rgba(80,40,150,0.35)";
  ctx.lineWidth = 1;
  for (let i = 64; i < 256; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 256);
    ctx.moveTo(0, i);
    ctx.lineTo(256, i);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(80, 80);
  return tex;
}

function sunsetSkyTexture() {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.0, "#120a2e");
  g.addColorStop(0.28, "#3b1060");
  g.addColorStop(0.5, "#7b1f6a");
  g.addColorStop(0.64, "#c62d55");
  g.addColorStop(0.75, "#f2622b");
  g.addColorStop(0.84, "#ffa63d");
  g.addColorStop(0.92, "#4c1750");
  g.addColorStop(1, "#1a0c28");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function asphaltTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#3a3f4b";
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2600; i++) {
    const v = 40 + Math.random() * 60;
    ctx.fillStyle = `rgba(${v},${v},${v + 14},0.5)`;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return tex;
}

function windowTexture(tint: string) {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0a0a16";
  ctx.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 8) {
    for (let x = 4; x < 60; x += 8) {
      if (Math.random() < 0.45) continue;
      ctx.fillStyle = Math.random() < 0.25 ? tint : "#f8f2c8";
      ctx.globalAlpha = 0.35 + Math.random() * 0.65;
      ctx.fillRect(x, y, 4, 5);
    }
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function Circuit({ samples }: { samples: Sample[] }) {
  const geo = useMemo(() => {
    const road = ribbon(samples, -ROAD_HALF, ROAD_HALF, 0);
    const edgeL = ribbon(samples, -ROAD_HALF - 0.7, -ROAD_HALF + 0.1, 0.06);
    const edgeR = ribbon(samples, ROAD_HALF - 0.1, ROAD_HALF + 0.7, 0.06);
    const mid = ribbon(samples, -0.16, 0.16, 0.05);
    const apron = ribbon(samples, -ROAD_HALF - 2.2, ROAD_HALF + 2.2, -0.35);
    return { road, edgeL, edgeR, mid, apron };
  }, [samples]);

  const asphalt = useMemo(asphaltTexture, []);

  // guardrails on the elevated portion + support pillars
  const bridge = useMemo(() => {
    const rails: { pos: [number, number, number]; rot: number; len: number }[] = [];
    const pillars: { pos: [number, number, number]; h: number }[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const s = samples[i];
      if (s.p.y < 0.6) continue;
      if (i % 6 === 0) {
        const rot = Math.atan2(s.n.z, s.n.x);
        for (const side of [-1, 1]) {
          rails.push({
            pos: [s.p.x + s.n.x * side * (ROAD_HALF + 0.4), s.p.y + 0.65, s.p.z + s.n.z * side * (ROAD_HALF + 0.4)],
            rot: -rot,
            len: 3.4,
          });
        }
      }
      if (i % 46 === 0 && s.p.y > 2.2) {
        pillars.push({ pos: [s.p.x, s.p.y / 2, s.p.z], h: s.p.y });
      }
    }
    // contiguous elevated index range (bump is centered on t = PI)
    let i0 = 0;
    let i1 = SAMPLES - 1;
    const mid = Math.round(SAMPLES / 2);
    while (i0 < mid && samples[i0].p.y < 0.15) i0++;
    while (i1 > mid && samples[i1].p.y < 0.15) i1--;
    const walls = [-1, 1].map((side) => ({
      body: barrier(samples, i0, i1, side * (ROAD_HALF + 0.55), 0, 1.15),
      cap: barrier(samples, i0, i1, side * (ROAD_HALF + 0.55), 1.15, 0.22),
      fascia: barrier(samples, i0, i1, side * (ROAD_HALF + 2.2), -1.6, 1.3),
      glow: barrier(samples, i0, i1, side * (ROAD_HALF + 2.2), -0.55, 0.18),
      side,
    }));
    return { rails, pillars, walls };
  }, [samples]);

  return (
    <group>
      <mesh geometry={geo.apron} receiveShadow>
        <meshStandardMaterial color="#181228" roughness={0.95} />
      </mesh>
      <mesh geometry={geo.road} receiveShadow>
        <meshStandardMaterial map={asphalt} color="#8b93a5" roughness={0.9} metalness={0.05} />
      </mesh>
      <mesh geometry={geo.edgeL}>
        <meshStandardMaterial color={NEON_CYAN} emissive={NEON_CYAN} emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
      <mesh geometry={geo.edgeR}>
        <meshStandardMaterial color={NEON_PINK} emissive={NEON_PINK} emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
      <mesh geometry={geo.mid}>
        <meshStandardMaterial color="#cfc9ff" emissive="#cfc9ff" emissiveIntensity={0.7} />
      </mesh>

      {/* start / finish */}
      <group
        position={[pointAt(0.35).x, pointAt(0.35).y + 0.07, pointAt(0.35).z]}
        rotation={[0, Math.atan2(pointAt(0.4).x - pointAt(0.35).x, pointAt(0.4).z - pointAt(0.35).z), 0]}
      >
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[ROAD_HALF * 2, 2]} />
          <meshStandardMaterial color="#f2f2ff" emissive="#f2f2ff" emissiveIntensity={0.8} />
        </mesh>
      </group>

      {/* elevated deck: side barriers, neon top rails and under-deck fascia */}
      {bridge.walls.map((w, i) => (
        <group key={`w${i}`}>
          <mesh geometry={w.body} castShadow>
            <meshStandardMaterial color="#2b2050" metalness={0.65} roughness={0.4} side={THREE.DoubleSide} />
          </mesh>
          <mesh geometry={w.cap}>
            <meshStandardMaterial
              color={w.side < 0 ? NEON_CYAN : NEON_PINK}
              emissive={w.side < 0 ? NEON_CYAN : NEON_PINK}
              emissiveIntensity={2.6}
              toneMapped={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh geometry={w.fascia}>
            <meshStandardMaterial color="#1d1636" metalness={0.5} roughness={0.6} side={THREE.DoubleSide} />
          </mesh>
          <mesh geometry={w.glow}>
            <meshStandardMaterial
              color={NEON_PURPLE}
              emissive={NEON_PURPLE}
              emissiveIntensity={1.8}
              toneMapped={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}
      {bridge.rails.map((r, i) => (
        <mesh key={`r${i}`} position={r.pos} rotation={[0, r.rot, 0]}>
          <boxGeometry args={[r.len, 0.9, 0.35]} />
          <meshStandardMaterial color="#2a1f4d" emissive={NEON_PURPLE} emissiveIntensity={1.1} metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      {bridge.pillars.map((p, i) => (
        <mesh key={`p${i}`} position={p.pos} castShadow>
          <boxGeometry args={[3, p.h, 3]} />
          <meshStandardMaterial color="#241c3c" emissive={NEON_CYAN} emissiveIntensity={0.25} metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

function City() {
  const texA = useMemo(() => windowTexture("#22d3ee"), []);
  const texB = useMemo(() => windowTexture("#ec4899"), []);

  const buildings = useMemo(() => {
    const rng = (() => {
      let s = 1337;
      return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    })();
    const out: {
      pos: [number, number, number];
      size: [number, number, number];
      tex: THREE.Texture;
      neon: string;
    }[] = [];
    for (let i = 0; i < 130; i++) {
      const ang = rng() * Math.PI * 2;
      const rad = 260 + rng() * 330;
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad * 0.9;
      const h = 30 + rng() * 150;
      const w = 14 + rng() * 26;
      const d = 14 + rng() * 26;
      out.push({
        pos: [x, h / 2, z],
        size: [w, h, d],
        tex: rng() > 0.5 ? texA : texB,
        neon: [NEON_CYAN, NEON_PINK, NEON_PURPLE, "#3b82f6"][Math.floor(rng() * 4)],
      });
    }
    return out;
  }, [texA, texB]);

  return (
    <group>
      {buildings.map((b, i) => (
        <group key={i} position={b.pos}>
          <mesh>
            <boxGeometry args={b.size} />
            <meshStandardMaterial
              color="#12102a"
              map={b.tex}
              emissive="#ffffff"
              emissiveMap={b.tex}
              emissiveIntensity={1.5}
              roughness={0.7}
              metalness={0.3}
            />
          </mesh>
          {/* rooftop neon crown */}
          <mesh position={[0, b.size[1] / 2 + 0.4, 0]}>
            <boxGeometry args={[b.size[0] * 1.04, 0.8, b.size[2] * 1.04]} />
            <meshStandardMaterial color={b.neon} emissive={b.neon} emissiveIntensity={2.4} toneMapped={false} />
          </mesh>
          {/* vertical neon strip */}
          <mesh position={[b.size[0] / 2 + 0.15, 0, 0]}>
            <boxGeometry args={[0.3, b.size[1] * 0.8, 0.6]} />
            <meshStandardMaterial color={b.neon} emissive={b.neon} emissiveIntensity={1.8} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ------------------------------- tank ---------------------------------------
const MAX_SPEED = 30;
const ACCEL = 16;
const BRAKE = 22;
const DRAG = 1.6;
const TURN_SPEED = 1.5;

function useKeys() {
  const keys = useRef<Record<string, boolean>>({});
  if (!(keys.current as any).__bound) {
    (keys.current as any).__bound = true;
    const down = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => (keys.current[e.code] = false);
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up);
  }
  return keys;
}

function Tank({ samples }: { samples: Sample[] }) {
  const group = useRef<THREE.Group>(null!);
  const tilt = useRef<THREE.Group>(null!);
  const speed = useRef(0);
  const yawVel = useRef(0);
  const idx = useRef(Math.round((0.35 / (Math.PI * 2)) * SAMPLES));
  const keys = useKeys();
  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const moveDir = new THREE.Vector3();

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const k = keys.current;
    const tank = group.current;

    const fwd = (k.ArrowUp || k.KeyW || k.KeyZ ? 1 : 0) - (k.ArrowDown || k.KeyS ? 1 : 0);
    if (fwd > 0) speed.current += ACCEL * delta;
    else if (fwd < 0) speed.current -= BRAKE * delta;
    else speed.current -= speed.current * DRAG * delta;
    speed.current = THREE.MathUtils.clamp(speed.current, -MAX_SPEED * 0.35, MAX_SPEED);
    if (Math.abs(speed.current) < 0.02) speed.current = 0;

    const turnInput = (k.ArrowLeft || k.KeyA || k.KeyQ ? 1 : 0) - (k.ArrowRight || k.KeyD ? 1 : 0);
    const grip = 0.45 + 0.55 * Math.min(1, Math.abs(speed.current) / (MAX_SPEED * 0.4));
    const targetYaw = turnInput * TURN_SPEED * grip;
    yawVel.current += (targetYaw - yawVel.current) * Math.min(1, delta * 6);
    tank.rotation.y += yawVel.current * delta;

    if (speed.current !== 0) {
      moveDir.set(Math.sin(tank.rotation.y), 0, Math.cos(tank.rotation.y));
      tank.position.addScaledVector(moveDir, speed.current * delta);
    }

    // --- locate the nearest centerline sample, searching around the previous
    // index so the two overlapping branches of the 8 never get confused ---
    let best = idx.current;
    let bestD = Infinity;
    const win = 90;
    for (let o = -win; o <= win; o++) {
      const i = (idx.current + o + SAMPLES) % SAMPLES;
      const p = samples[i].p;
      const dx = tank.position.x - p.x;
      const dz = tank.position.z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    idx.current = best;
    const s = samples[best];
    const lateral = (tank.position.x - s.p.x) * s.n.x + (tank.position.z - s.p.z) * s.n.z;
    const onRoad = Math.abs(lateral) <= ROAD_HALF + 0.6;

    // guardrails: while elevated, never allow leaving the deck
    if (s.p.y > 0.5) {
      const lim = ROAD_HALF - 0.9;
      if (Math.abs(lateral) > lim) {
        const corr = lateral - Math.sign(lateral) * lim;
        tank.position.x -= s.n.x * corr;
        tank.position.z -= s.n.z * corr;
        speed.current *= 0.55;
      }
    } else if (!onRoad) {
      // off-road: dirt slows the tank hard
      speed.current *= 1 - Math.min(0.9, 3.2 * delta);
    }

    // ground locking: follow the road surface height, flat ground elsewhere
    const targetY = onRoad || s.p.y > 0.5 ? s.p.y : 0;
    tank.position.y = THREE.MathUtils.lerp(tank.position.y, targetY, 1 - Math.pow(0.0001, delta));

    // keep everything inside the city block
    const LIM = 520;
    tank.position.x = THREE.MathUtils.clamp(tank.position.x, -LIM, LIM);
    tank.position.z = THREE.MathUtils.clamp(tank.position.z, -LIM, LIM);

    tank.rotation.x = 0;
    tank.rotation.z = 0;

    const t = tilt.current;
    t.rotation.z = THREE.MathUtils.lerp(t.rotation.z, -yawVel.current * 0.05, 0.1);
    t.rotation.x = THREE.MathUtils.lerp(t.rotation.x, -speed.current * 0.004, 0.08);

    const behind = new THREE.Vector3(0, 4.2, -9).applyEuler(new THREE.Euler(0, tank.rotation.y, 0));
    camPos.copy(tank.position).add(behind);
    state.camera.position.lerp(camPos, 1 - Math.pow(0.0015, delta));
    camTarget.copy(tank.position).add(new THREE.Vector3(0, 1.6, 0));
    state.camera.lookAt(camTarget);
  });

  const start = pointAt(0.35);
  const startAhead = pointAt(0.4);
  const yaw = Math.atan2(startAhead.x - start.x, startAhead.z - start.z);

  return (
    <group ref={group} position={[start.x, start.y, start.z]} rotation={[0, yaw, 0]}>
      <group ref={tilt} position={[0, 0.35, 0]}>
        <group position={[0, -0.35, 0]}>
          <TankBody />
        </group>
      </group>
    </group>
  );
}

const NeonCityScene = () => {
  const samples = useMemo(buildSamples, []);

  return (
    <Canvas shadows camera={{ position: [0, 6, -12], fov: 62 }} dpr={[1, 2]}>
      <color attach="background" args={["#07040f"]} />
      <fog attach="fog" args={["#150b2b", 180, 700]} />

      {/* night sky with a glowing urban horizon */}
      <mesh scale={[-1, 1, 1]}>
        <sphereGeometry args={[900, 32, 16]} />
        <meshBasicMaterial color="#0b0620" side={THREE.BackSide} fog={false} />
      </mesh>
      <mesh position={[0, 20, 0]}>
        <cylinderGeometry args={[820, 820, 90, 48, 1, true]} />
        <meshBasicMaterial color="#5b1d6e" side={THREE.BackSide} transparent opacity={0.75} fog={false} />
      </mesh>

      <hemisphereLight args={["#7c5bd8", "#120a22", 0.75] as const} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[80, 120, -60]} intensity={1.1} color="#b18bff" castShadow shadow-mapSize={[2048, 2048]} />
      <directionalLight position={[-90, 70, 80]} intensity={0.6} color="#22d3ee" />

      {/* city ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
        <planeGeometry args={[1600, 1600]} />
        <meshStandardMaterial color="#0e0a1c" roughness={0.85} metalness={0.15} />
      </mesh>

      <Circuit samples={samples} />
      <City />
      <Tank samples={samples} />
    </Canvas>
  );
};

export default NeonCityScene;
