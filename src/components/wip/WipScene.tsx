import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Grid } from "@react-three/drei";
import * as THREE from "three";

const MOVE_SPEED = 6;
const TURN_SPEED = 2.4;

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

function Player() {
  const group = useRef<THREE.Group>(null!);
  const keys = useKeys();
  const camTarget = new THREE.Vector3();
  const camPos = new THREE.Vector3();

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const k = keys.current;
    const player = group.current;

    const turn = (k.ArrowLeft || k.KeyA || k.KeyQ ? 1 : 0) - (k.ArrowRight || k.KeyD ? 1 : 0);
    player.rotation.y += turn * TURN_SPEED * delta;

    const fwd = (k.ArrowUp || k.KeyW || k.KeyZ ? 1 : 0) - (k.ArrowDown || k.KeyS ? 1 : 0);
    if (fwd !== 0) {
      const dir = new THREE.Vector3(0, 0, 1).applyEuler(player.rotation);
      player.position.addScaledVector(dir, fwd * MOVE_SPEED * delta);
    }

    // Third-person camera: behind and above, smoothed
    const behind = new THREE.Vector3(0, 3.2, -6.5).applyEuler(player.rotation);
    camPos.copy(player.position).add(behind);
    state.camera.position.lerp(camPos, 1 - Math.pow(0.001, delta));
    camTarget.copy(player.position).add(new THREE.Vector3(0, 1.2, 0));
    state.camera.lookAt(camTarget);
  });

  return (
    <group ref={group} position={[0, 0, 0]}>
      <mesh position={[0, 1, 0]} castShadow>
        <capsuleGeometry args={[0.5, 1, 8, 16]} />
        <meshStandardMaterial color="#22d3ee" emissive="#0ea5b7" emissiveIntensity={0.35} roughness={0.35} />
      </mesh>
      {/* facing indicator */}
      <mesh position={[0, 1, 0.65]} castShadow>
        <boxGeometry args={[0.3, 0.3, 0.5]} />
        <meshStandardMaterial color="#ec4899" emissive="#ec4899" emissiveIntensity={0.6} />
      </mesh>
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

      <Player />
    </Canvas>
  );
};

export default WipScene;
