import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { TankBody } from "./WipScene";
import {
  createRace,
  snapshot,
  stepRace,
  type Input,
  type RaceSnapshot,
  type TrackConfig,
} from "./raceCore";

function useKeys() {
  const keys = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => (keys.current[e.code] = false);
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
  return keys;
}

type Props = {
  cfg: TrackConfig;
  onSnapshot?: (s: RaceSnapshot) => void;
  camHeight?: number;
  camBack?: number;
};

export default function Racers({ cfg, onSnapshot, camHeight = 4.2, camBack = 9 }: Props) {
  // the race object must survive parent re-renders (HUD updates every 0.1s)
  const raceRef = useRef<ReturnType<typeof createRace> | null>(null);
  if (!raceRef.current) raceRef.current = createRace(cfg);
  const race = raceRef.current;
  const keys = useKeys();

  const groups = useRef<(THREE.Group | null)[]>([]);
  const tilts = useRef<(THREE.Group | null)[]>([]);
  const shots = useRef<THREE.Group | null>(null);
  const pool = useRef<THREE.Mesh[]>([]);
  const acc = useRef(0);
  const firedHeld = useRef(false);
  const camPos = useMemo(() => new THREE.Vector3(), []);
  const camTarget = useMemo(() => new THREE.Vector3(), []);
  const behind = useMemo(() => new THREE.Vector3(), []);
  const euler = useMemo(() => new THREE.Euler(), []);

  useFrame((state, rawDelta) => {
    const k = keys.current;
    const fireKey = !!(k.Space || k.KeyF || k.ControlLeft);
    const fire = fireKey && !firedHeld.current;
    firedHeld.current = fireKey;
    const input: Input = {
      throttle: (k.ArrowUp || k.KeyW || k.KeyZ ? 1 : 0) - (k.ArrowDown || k.KeyS ? 1 : 0),
      steer: (k.ArrowLeft || k.KeyA || k.KeyQ ? 1 : 0) - (k.ArrowRight || k.KeyD ? 1 : 0),
      fire,
    };
    stepRace(race, rawDelta, input);

    // projectiles: reuse a small pool of glowing bolts
    const grp = shots.current;
    if (grp) {
      while (pool.current.length < race.projectiles.length) {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(0.45, 10, 8),
          new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 3, toneMapped: false }),
        );
        pool.current.push(m);
        grp.add(m);
      }
      pool.current.forEach((m, i) => {
        const p = race.projectiles[i];
        m.visible = !!p;
        if (p) {
          m.position.copy(p.pos);
          (m.material as THREE.MeshStandardMaterial).color.set(p.color);
          (m.material as THREE.MeshStandardMaterial).emissive.set(p.color);
        }
      });
    }


    race.racers.forEach((r, i) => {
      const g = groups.current[i];
      if (!g) return;
      g.position.copy(r.pos);
      g.rotation.set(0, r.yaw, 0);
      const t = tilts.current[i];
      if (t) {
        t.rotation.z = r.roll;
        t.rotation.x = r.pitch;
      }
    });

    const p = race.racers[0];
    behind.set(0, camHeight, -camBack).applyEuler(euler.set(0, p.yaw, 0));
    camPos.copy(p.pos).add(behind);
    state.camera.position.lerp(camPos, 1 - Math.pow(0.0015, Math.min(rawDelta, 0.05)));
    camTarget.set(p.pos.x, p.pos.y + 1.6, p.pos.z);
    state.camera.lookAt(camTarget);

    acc.current += rawDelta;
    if (onSnapshot && (acc.current > 0.1 || race.status === "finished")) {
      acc.current = 0;
      onSnapshot(snapshot(race));
    }
  });

  return (
    <>
      {race.racers.map((r, i) => (
        <group
          key={r.id}
          ref={(el) => (groups.current[i] = el)}
          position={[r.pos.x, r.pos.y, r.pos.z]}
          rotation={[0, r.yaw, 0]}
        >
          <group ref={(el) => (tilts.current[i] = el)} position={[0, 0.35, 0]}>
            <group position={[0, -0.35, 0]}>
              <TankBody
                hull={r.colors.hull}
                hullLight={r.colors.hullLight}
                turret={r.colors.turret}
                metalness={0.85}
                roughness={0.22}
              />
            </group>
          </group>
          {!r.isPlayer && (
            <pointLight position={[0, 1.6, 0]} color={r.colors.hull} intensity={5} distance={9} />
          )}
        </group>
      ))}
    </>
  );
}
