import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Grid } from "@react-three/drei";
import * as THREE from "three";

const MAX_SPEED = 9;
const ACCEL = 9;
const BRAKE = 14;
const DRAG = 2.2;
const TURN_SPEED = 1.9;

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

const NEON_CYAN = "#22d3ee";
const NEON_PINK = "#ec4899";

export function TankBody({
  hull = "#4a5670",
  hullLight = "#55627e",
  turret = "#5b6a8a",
  metalness = 0.55,
  roughness = 0.35,
}: {
  hull?: string;
  hullLight?: string;
  turret?: string;
  metalness?: number;
  roughness?: number;
}) {
  return (
    <group>
      {/* Tracks */}
      {[-0.72, 0.72].map((x) => (
        <group key={x} position={[x, 0.32, 0]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.42, 0.6, 2.3]} />
            <meshStandardMaterial color="#3c4457" metalness={0.7} roughness={0.55} />
          </mesh>
          {/* neon strip along track */}
          <mesh position={[x > 0 ? 0.22 : -0.22, 0.05, 0]}>
            <boxGeometry args={[0.03, 0.1, 2.1]} />
            <meshStandardMaterial color={NEON_CYAN} emissive={NEON_CYAN} emissiveIntensity={1.6} />
          </mesh>
          {/* wheels hint */}
          {[-0.8, -0.27, 0.27, 0.8].map((z) => (
            <mesh key={z} position={[0, -0.16, z]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.16, 0.16, 0.46, 12]} />
              <meshStandardMaterial color="#2b3243" metalness={0.6} roughness={0.7} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Hull */}
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.6, 0.42, 2.4]} />
        <meshStandardMaterial color={hull} metalness={metalness} roughness={roughness} />
      </mesh>
      {/* Sloped front glacis */}
      <mesh position={[0, 0.6, 1.15]} rotation={[-0.5, 0, 0]} castShadow>
        <boxGeometry args={[1.55, 0.5, 0.36]} />
        <meshStandardMaterial color={hullLight} metalness={metalness} roughness={roughness} />
      </mesh>
      {/* Hull neon edge strips */}
      {[-0.81, 0.81].map((x) => (
        <mesh key={x} position={[x, 0.9, 0]}>
          <boxGeometry args={[0.04, 0.06, 2.3]} />
          <meshStandardMaterial color={NEON_PINK} emissive={NEON_PINK} emissiveIntensity={1.8} />
        </mesh>
      ))}

      {/* Turret */}
      <group position={[0, 1.08, -0.1]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.62, 0.72, 0.45, 8]} />
          <meshStandardMaterial color={turret} metalness={0.8} roughness={roughness} />
        </mesh>
        <mesh position={[0, 0.25, 0]}>
          <cylinderGeometry args={[0.5, 0.6, 0.06, 8]} />
          <meshStandardMaterial color={NEON_CYAN} emissive={NEON_CYAN} emissiveIntensity={1.4} />
        </mesh>
        {/* Barrel */}
        <mesh position={[0, 0.02, 1.05]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.11, 0.13, 1.9, 12]} />
          <meshStandardMaterial color="#3c4457" metalness={0.85} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.02, 1.95]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.15, 0.15, 0.16, 12]} />
          <meshStandardMaterial color={NEON_PINK} emissive={NEON_PINK} emissiveIntensity={2} />
        </mesh>
      </group>

      {/* Under-glow */}
      <pointLight position={[0, 0.2, 0]} color={NEON_CYAN} intensity={6} distance={5} />
    </group>
  );
}

// Ground plane elevation; tank origin sits exactly on this surface.
const GROUND_Y = 0;

// ---- Circuit geometry (stadium / athletic-track oval) ----
const STRAIGHT_HALF = 30; // half length of the parallel straights (along Z)
const CENTER_R = 24; // radius of the centerline curves
const TRACK_HALF_W = 9; // half width of the road
const INNER_R = CENTER_R - TRACK_HALF_W;
const OUTER_R = CENTER_R + TRACK_HALF_W;
const ARENA_X = 48;
const ARENA_Z = STRAIGHT_HALF + 34;
const TANK_R = 1.2;

// distance from a point (x,z) to the oval centerline (capsule segment on the Z axis)
function centerlineDist(x: number, z: number) {
  const cz = THREE.MathUtils.clamp(z, -STRAIGHT_HALF, STRAIGHT_HALF);
  return Math.hypot(x, z - cz);
}

function stadiumShape(radius: number, seg = 48) {
  const s = new THREE.Shape();
  s.moveTo(radius, -STRAIGHT_HALF);
  s.lineTo(radius, STRAIGHT_HALF);
  for (let i = 1; i <= seg; i++) {
    const t = (i / seg) * Math.PI;
    s.lineTo(radius * Math.cos(t), STRAIGHT_HALF + radius * Math.sin(t));
  }
  s.lineTo(-radius, -STRAIGHT_HALF);
  for (let i = 1; i <= seg; i++) {
    const t = Math.PI + (i / seg) * Math.PI;
    s.lineTo(radius * Math.cos(t), -STRAIGHT_HALF + radius * Math.sin(t));
  }
  s.closePath();
  return s;
}

function ringShape(outer: number, inner: number) {
  const s = stadiumShape(outer);
  s.holes.push(new THREE.Path(stadiumShape(inner).getPoints(200)));
  return s;
}

function Track() {
  const road = new THREE.ShapeGeometry(ringShape(OUTER_R, INNER_R), 12);
  const outerLine = new THREE.ShapeGeometry(ringShape(OUTER_R, OUTER_R - 0.5), 12);
  const innerLine = new THREE.ShapeGeometry(ringShape(INNER_R + 0.5, INNER_R), 12);
  const midLine = new THREE.ShapeGeometry(ringShape(CENTER_R + 0.14, CENTER_R - 0.14), 12);
  const island = new THREE.ExtrudeGeometry(stadiumShape(INNER_R), {
    depth: 1.1,
    bevelEnabled: false,
    curveSegments: 12,
  });

  return (
    <group>
      {/* road surface */}
      <mesh geometry={road} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <meshStandardMaterial color="#59606b" roughness={0.92} metalness={0.05} />
      </mesh>

      {/* neon borders */}
      <mesh geometry={outerLine} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <meshStandardMaterial color={NEON_PINK} emissive={NEON_PINK} emissiveIntensity={2} toneMapped={false} />
      </mesh>
      <mesh geometry={innerLine} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <meshStandardMaterial color={NEON_CYAN} emissive={NEON_CYAN} emissiveIntensity={2} toneMapped={false} />
      </mesh>
      <mesh geometry={midLine} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]}>
        <meshStandardMaterial color="#5b5b7a" emissive="#5b5b7a" emissiveIntensity={0.5} />
      </mesh>
      {/* start / finish line */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[CENTER_R, 0.05, 0]}>
        <planeGeometry args={[TRACK_HALF_W * 2, 1.4]} />
        <meshStandardMaterial color="#e8e8f5" emissive="#e8e8f5" emissiveIntensity={0.6} />
      </mesh>

      {/* inner island barrier */}
      <mesh geometry={island} rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.1, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#2b6b52" metalness={0.25} roughness={0.7} />
      </mesh>
      <mesh geometry={new THREE.ShapeGeometry(ringShape(INNER_R, INNER_R - 0.45), 12)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.12, 0]}>
        <meshStandardMaterial color={NEON_CYAN} emissive={NEON_CYAN} emissiveIntensity={2.2} toneMapped={false} />
      </mesh>

      {/* outer perimeter walls */}
      {[
        { p: [0, 1.5, ARENA_Z] as const, s: [ARENA_X * 2, 3, 1] as const },
        { p: [0, 1.5, -ARENA_Z] as const, s: [ARENA_X * 2, 3, 1] as const },
        { p: [ARENA_X, 1.5, 0] as const, s: [1, 3, ARENA_Z * 2] as const },
        { p: [-ARENA_X, 1.5, 0] as const, s: [1, 3, ARENA_Z * 2] as const },
      ].map((w, i) => (
        <group key={i}>
          <mesh position={w.p as unknown as [number, number, number]} castShadow receiveShadow>
            <boxGeometry args={w.s as unknown as [number, number, number]} />
            <meshStandardMaterial
              color="#0e5f73"
              emissive={NEON_CYAN}
              emissiveIntensity={0.45}
              metalness={0.5}
              roughness={0.4}
            />
          </mesh>
          <mesh position={[w.p[0], 3.05, w.p[2]]}>
            <boxGeometry args={[w.s[0] * 1.005, 0.16, w.s[2] * 1.005]} />
            <meshStandardMaterial color={NEON_CYAN} emissive={NEON_CYAN} emissiveIntensity={2.4} toneMapped={false} />
          </mesh>

        </group>
      ))}
    </group>
  );
}

function Tank() {
  const group = useRef<THREE.Group>(null!);
  const tilt = useRef<THREE.Group>(null!);
  const speed = useRef(0);
  const yawVel = useRef(0);
  const keys = useKeys();
  const camTarget = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const moveDir = new THREE.Vector3();

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const k = keys.current;
    const tank = group.current;

    const fwd = (k.ArrowUp || k.KeyW || k.KeyZ ? 1 : 0) - (k.ArrowDown || k.KeyS ? 1 : 0);
    if (fwd > 0) speed.current += ACCEL * delta;
    else if (fwd < 0) speed.current -= BRAKE * delta;
    else speed.current -= speed.current * DRAG * delta;
    speed.current = THREE.MathUtils.clamp(speed.current, -MAX_SPEED * 0.45, MAX_SPEED);
    if (Math.abs(speed.current) < 0.02) speed.current = 0;

    // heavy vehicle steering: eased yaw, slightly reduced at very low speed
    const turnInput = (k.ArrowLeft || k.KeyA || k.KeyQ ? 1 : 0) - (k.ArrowRight || k.KeyD ? 1 : 0);
    const grip = 0.45 + 0.55 * Math.min(1, Math.abs(speed.current) / (MAX_SPEED * 0.5));
    const targetYaw = turnInput * TURN_SPEED * grip;
    yawVel.current += (targetYaw - yawVel.current) * Math.min(1, delta * 5);
    tank.rotation.y += yawVel.current * delta;

    if (speed.current !== 0) {
      // move strictly in the XZ plane (yaw only) so height never drifts
      moveDir.set(Math.sin(tank.rotation.y), 0, Math.cos(tank.rotation.y));
      tank.position.addScaledVector(moveDir, speed.current * delta);
    }

    // --- collisions ---
    // outer arena walls
    const limX = ARENA_X - 0.5 - TANK_R;
    const limZ = ARENA_Z - 0.5 - TANK_R;
    let hit = false;
    if (tank.position.x > limX) { tank.position.x = limX; hit = true; }
    if (tank.position.x < -limX) { tank.position.x = -limX; hit = true; }
    if (tank.position.z > limZ) { tank.position.z = limZ; hit = true; }
    if (tank.position.z < -limZ) { tank.position.z = -limZ; hit = true; }

    // inner island barrier (push outwards from the oval centerline)
    const cz = THREE.MathUtils.clamp(tank.position.z, -STRAIGHT_HALF, STRAIGHT_HALF);
    const dx = tank.position.x;
    const dz = tank.position.z - cz;
    const d = Math.hypot(dx, dz) || 1e-4;
    const minD = INNER_R + TANK_R;
    if (d < minD) {
      const nx = dx / d;
      const nz = dz / d;
      tank.position.x = nx * minD;
      tank.position.z = cz + nz * minD;
      hit = true;
    }
    if (hit) speed.current *= 0.35;

    // grass slows the tank down significantly
    const dist = centerlineDist(tank.position.x, tank.position.z);
    if (dist > OUTER_R) speed.current *= 1 - Math.min(0.9, 3 * delta);

    // hard lock to the ground surface
    tank.position.y = GROUND_Y;
    tank.rotation.x = 0;
    tank.rotation.z = 0;

    // cosmetic body roll / pitch applied to a child so the chassis stays grounded
    const t = tilt.current;
    t.rotation.z = THREE.MathUtils.lerp(t.rotation.z, -yawVel.current * 0.04, 0.1);
    t.rotation.x = THREE.MathUtils.lerp(t.rotation.x, -speed.current * 0.005, 0.08);

    const behind = new THREE.Vector3(0, 3.6, -7.5).applyEuler(new THREE.Euler(0, tank.rotation.y, 0));
    camPos.copy(tank.position).add(behind);
    state.camera.position.lerp(camPos, 1 - Math.pow(0.0015, delta));
    camTarget.copy(tank.position).add(new THREE.Vector3(0, 1.3, 0));
    state.camera.lookAt(camTarget);
  });

  return (
    <group ref={group} position={[CENTER_R, GROUND_Y, 0]} rotation={[0, Math.PI, 0]}>
      {/* pivot raised so cosmetic tilt rotates around the track contact line */}
      <group ref={tilt} position={[0, 0.35, 0]}>
        <group position={[0, -0.35, 0]}>
          <TankBody />
        </group>
      </group>
    </group>
  );
}

const WipScene = () => {
  return (
    <Canvas shadows camera={{ position: [0, 4, -8], fov: 60 }} dpr={[1, 2]}>
      <color attach="background" args={["#2a1a4d"]} />
      <fog attach="fog" args={["#3b2566", 60, 200]} />

      {/* twilight sky dome */}
      <mesh scale={[-1, 1, 1]}>
        <sphereGeometry args={[300, 32, 16]} />
        <meshBasicMaterial color="#3b2566" side={THREE.BackSide} fog={false} />
      </mesh>

      <hemisphereLight args={["#8b6bd8", "#2f5f45", 0.9] as const} />
      <ambientLight intensity={0.85} />
      <directionalLight
        position={[10, 18, 8]}
        intensity={2.1}
        color="#fff3e0"
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <directionalLight position={[-14, 10, -12]} intensity={0.7} color="#7ad7ff" />

      {/* grass / terrain */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ARENA_X * 2, ARENA_Z * 2]} />
        <meshStandardMaterial color="#2f8f4e" roughness={0.95} />
      </mesh>

      <Grid
        args={[ARENA_X * 2, ARENA_Z * 2]}
        cellSize={2}
        cellThickness={0.6}
        cellColor="#3fae63"
        sectionSize={10}
        sectionThickness={1.2}
        sectionColor="#7bf0a5"
        fadeDistance={140}
        fadeStrength={1.2}
        position={[0, 0.01, 0]}
      />


      <Track />
      <Tank />
    </Canvas>
  );
};

export default WipScene;

