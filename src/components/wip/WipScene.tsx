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

function TankBody() {
  return (
    <group>
      {/* Tracks */}
      {[-0.72, 0.72].map((x) => (
        <group key={x} position={[x, 0.32, 0]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.42, 0.6, 2.3]} />
            <meshStandardMaterial color="#15151f" metalness={0.7} roughness={0.55} />
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
              <meshStandardMaterial color="#0d0d14" metalness={0.6} roughness={0.7} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Hull */}
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.6, 0.42, 2.4]} />
        <meshStandardMaterial color="#1b1b28" metalness={0.75} roughness={0.4} />
      </mesh>
      {/* Sloped front glacis */}
      <mesh position={[0, 0.6, 1.15]} rotation={[-0.5, 0, 0]} castShadow>
        <boxGeometry args={[1.55, 0.5, 0.36]} />
        <meshStandardMaterial color="#20202f" metalness={0.75} roughness={0.4} />
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
          <meshStandardMaterial color="#23233a" metalness={0.8} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.25, 0]}>
          <cylinderGeometry args={[0.5, 0.6, 0.06, 8]} />
          <meshStandardMaterial color={NEON_CYAN} emissive={NEON_CYAN} emissiveIntensity={1.4} />
        </mesh>
        {/* Barrel */}
        <mesh position={[0, 0.02, 1.05]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.11, 0.13, 1.9, 12]} />
          <meshStandardMaterial color="#15151f" metalness={0.85} roughness={0.3} />
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
    <group ref={group} position={[0, GROUND_Y, 0]}>
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
      <color attach="background" args={["#08080f"]} />
      <fog attach="fog" args={["#08080f", 25, 90]} />

      <ambientLight intensity={0.45} />
      <directionalLight
        position={[10, 18, 8]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#12121c" roughness={0.9} />
      </mesh>

      <Grid
        args={[400, 400]}
        cellSize={2}
        cellThickness={0.6}
        cellColor="#1e3a4a"
        sectionSize={10}
        sectionThickness={1.2}
        sectionColor="#22d3ee"
        fadeDistance={80}
        fadeStrength={1.5}
        position={[0, 0.01, 0]}
        infiniteGrid
      />

      <Tank />
    </Canvas>
  );
};

export default WipScene;
