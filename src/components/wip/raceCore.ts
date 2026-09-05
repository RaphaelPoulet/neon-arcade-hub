import * as THREE from "three";

// ---------------------------------------------------------------------------
// Shared racing core: waypoint parsing, AI drivers, pushing collisions,
// sequential checkpoints and lap timing. Circuit agnostic — any track that can
// provide a centerline sample list works.
// ---------------------------------------------------------------------------

export type Sample = { p: THREE.Vector3; n: THREE.Vector3 };

export type RacerColors = { hull: string; hullLight: string; turret: string };

export type Racer = {
  id: number;
  name: string;
  colors: RacerColors;
  isPlayer: boolean;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  yawVel: number;
  idx: number;
  prevIdx: number;
  lat: number;
  laps: number;
  nextCp: number;
  finished: boolean;
  time: number;
  place: number;
  // AI personality
  lineOffset: number;
  skill: number;
  phase: number;
  // cosmetic
  roll: number;
  pitch: number;
};

export type Physics = {
  maxSpeed: number;
  accel: number;
  brake: number;
  drag: number;
  turnSpeed: number;
};

export type TrackConfig = {
  samples: Sample[];
  startIdx: number;
  roadHalf: number;
  physics: Physics;
  /** hard-clamp racers to the road at all times (closed arena circuits) */
  clampAlways: boolean;
};

export const TOTAL_LAPS = 3;
export const CP_COUNT = 8;
export const RACER_R = 1.35;

export type RaceStatus = "countdown" | "racing" | "finished";

export type Race = {
  cfg: TrackConfig;
  cps: number[];
  racers: Racer[];
  elapsed: number;
  countdown: number;
  status: RaceStatus;
};

export type Input = { throttle: number; steer: number };

export const PLAYER_COLORS: RacerColors = {
  hull: "#ff7a18",
  hullLight: "#ffb347",
  turret: "#ffd08a",
};

const BOTS: { name: string; colors: RacerColors; skill: number; line: number }[] = [
  {
    name: "VOLT",
    colors: { hull: "#22ff88", hullLight: "#7dffbe", turret: "#c6ffe4" },
    skill: 0.92,
    line: -2.6,
  },
  {
    name: "AMPER",
    colors: { hull: "#ffe600", hullLight: "#fff27a", turret: "#fffbd1" },
    skill: 0.86,
    line: 2.8,
  },
  {
    name: "HEX",
    colors: { hull: "#a855f7", hullLight: "#d4a6ff", turret: "#ecd7ff" },
    skill: 0.8,
    line: 0.2,
  },
];

function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function createRace(cfg: TrackConfig): Race {
  const N = cfg.samples.length;
  const cps: number[] = [];
  for (let i = 0; i < CP_COUNT; i++) {
    cps.push((cfg.startIdx + Math.round((i / CP_COUNT) * N)) % N);
  }

  const racers: Racer[] = [];
  const grid = [
    { lat: -3.2, back: 0 },
    { lat: 3.2, back: 0 },
    { lat: -3.2, back: 1 },
    { lat: 3.2, back: 1 },
  ];
  const order = [0, 1, 2, 3];
  for (let i = 0; i < 4; i++) {
    const g = grid[order[i]];
    const rowSpacing = Math.max(6, Math.round(N / 120));
    const idx = (cfg.startIdx - g.back * rowSpacing - rowSpacing + N * 2) % N;
    const s = cfg.samples[idx];
    const ahead = cfg.samples[(idx + 4) % N];
    const yaw = Math.atan2(ahead.p.x - s.p.x, ahead.p.z - s.p.z);
    const isPlayer = i === 0;
    const bot = BOTS[i - 1];
    racers.push({
      id: i,
      name: isPlayer ? "YOU" : bot.name,
      colors: isPlayer ? PLAYER_COLORS : bot.colors,
      isPlayer,
      pos: new THREE.Vector3(s.p.x + s.n.x * g.lat, s.p.y, s.p.z + s.n.z * g.lat),
      yaw,
      speed: 0,
      yawVel: 0,
      idx,
      prevIdx: idx,
      lat: g.lat,
      laps: 0,
      nextCp: 1,
      finished: false,
      time: 0,
      place: i + 1,
      lineOffset: isPlayer ? 0 : bot.line,
      skill: isPlayer ? 1 : bot.skill,
      phase: isPlayer ? 0 : i * 2.1 + 0.7,
      roll: 0,
      pitch: 0,
    });
  }

  return { cfg, cps, racers, elapsed: 0, countdown: 3.2, status: "countdown" };
}

function relocate(race: Race, r: Racer) {
  const { samples } = race.cfg;
  const N = samples.length;
  let best = r.idx;
  let bestD = Infinity;
  const win = Math.max(40, Math.round(N / 16));
  for (let o = -win; o <= win; o++) {
    const i = (r.idx + o + N) % N;
    const p = samples[i].p;
    const dx = r.pos.x - p.x;
    const dz = r.pos.z - p.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  r.prevIdx = r.idx;
  r.idx = best;
  const s = samples[best];
  r.lat = (r.pos.x - s.p.x) * s.n.x + (r.pos.z - s.p.z) * s.n.z;
  return s;
}

function arcContains(from: number, to: number, target: number, N: number) {
  const span = (to - from + N) % N;
  if (span === 0 || span > N / 4) return false;
  const off = (target - from + N) % N;
  return off > 0 && off <= span;
}

function checkpoints(race: Race, r: Racer) {
  const N = race.cfg.samples.length;
  const cpIdx = race.cps[r.nextCp];
  if (arcContains(r.prevIdx, r.idx, cpIdx, N)) {
    if (r.nextCp === 0) {
      r.laps += 1;
      r.nextCp = 1;
      if (r.laps >= TOTAL_LAPS && !r.finished) {
        r.finished = true;
        r.time = race.elapsed;
      }
    } else {
      r.nextCp = (r.nextCp + 1) % CP_COUNT;
    }
  }
}

export function progressOf(race: Race, r: Racer) {
  const N = race.cfg.samples.length;
  const rel = (r.idx - race.cfg.startIdx + N) % N;
  return r.laps * N + rel;
}

function aiInput(race: Race, r: Racer): Input {
  const { samples, roadHalf } = race.cfg;
  const N = samples.length;
  const lookahead = Math.round(N / 120 + r.speed * (N / 900));
  const a = samples[(r.idx + Math.max(6, lookahead)) % N];
  const far = samples[(r.idx + Math.max(12, lookahead * 3)) % N];

  // desired racing line, adapted when fighting for space
  let off = r.lineOffset;
  for (const o of race.racers) {
    if (o === r) continue;
    const rel = (o.idx - r.idx + N) % N;
    if (rel > 0 && rel < Math.max(18, N / 45)) {
      const dl = o.lat - r.lat;
      if (Math.abs(dl) < 4.2) {
        const dir = dl >= 0 ? -1 : 1;
        off = THREE.MathUtils.clamp(r.lat + dir * 5.5, -roadHalf + 1.6, roadHalf - 1.6);
      }
    }
  }
  off = THREE.MathUtils.clamp(off, -roadHalf + 1.4, roadHalf - 1.4);

  const tx = a.p.x + a.n.x * off;
  const tz = a.p.z + a.n.z * off;
  const desired = Math.atan2(tx - r.pos.x, tz - r.pos.z);
  let err = wrapAngle(desired - r.yaw);

  // human-like wobble: bots are not perfect
  const wobble = Math.sin(race.elapsed * (1.1 + r.phase * 0.3) + r.phase) * 0.16 * (1 - r.skill) * 6;
  err += wobble * 0.12;

  const steer = THREE.MathUtils.clamp(err * 2.2, -1, 1);

  // brake for the corner ahead
  const curve = Math.abs(wrapAngle(Math.atan2(far.p.x - a.p.x, far.p.z - a.p.z) - r.yaw));
  let throttle = 1;
  if (curve > 0.55) throttle = 0.25;
  else if (curve > 0.3) throttle = 0.6;
  if (Math.abs(err) > 0.9) throttle = Math.min(throttle, 0.3);
  const hesitation = 0.9 + 0.1 * Math.sin(race.elapsed * 0.8 + r.phase * 3);
  return { throttle: throttle * (0.82 + r.skill * 0.18) * hesitation, steer };
}

function drive(race: Race, r: Racer, input: Input, delta: number) {
  const ph = race.cfg.physics;
  const cap = ph.maxSpeed * (r.isPlayer ? 1 : 0.9 + r.skill * 0.12);

  if (input.throttle > 0) r.speed += ph.accel * input.throttle * delta;
  else if (input.throttle < 0) r.speed += ph.brake * input.throttle * delta;
  else r.speed -= r.speed * ph.drag * delta;
  r.speed = THREE.MathUtils.clamp(r.speed, -cap * 0.35, cap);
  if (Math.abs(r.speed) < 0.02) r.speed = 0;

  const grip = 0.45 + 0.55 * Math.min(1, Math.abs(r.speed) / (ph.maxSpeed * 0.4));
  const targetYaw = input.steer * ph.turnSpeed * grip;
  r.yawVel += (targetYaw - r.yawVel) * Math.min(1, delta * 6);
  r.yaw += r.yawVel * delta;

  if (r.speed !== 0) {
    r.pos.x += Math.sin(r.yaw) * r.speed * delta;
    r.pos.z += Math.cos(r.yaw) * r.speed * delta;
  }
}

function trackConstraints(race: Race, r: Racer, delta: number) {
  const { roadHalf, clampAlways } = race.cfg;
  const s = relocate(race, r);
  const elevated = s.p.y > 0.5;
  const onRoad = Math.abs(r.lat) <= roadHalf + 0.6;

  if (elevated || clampAlways) {
    const lim = roadHalf - 0.9;
    if (Math.abs(r.lat) > lim) {
      const corr = r.lat - Math.sign(r.lat) * lim;
      r.pos.x -= s.n.x * corr;
      r.pos.z -= s.n.z * corr;
      r.lat -= corr;
      r.speed *= 0.55;
    }
  } else if (!onRoad) {
    r.speed *= 1 - Math.min(0.9, 3.2 * delta);
    const lim = roadHalf + 14;
    if (Math.abs(r.lat) > lim) {
      const corr = r.lat - Math.sign(r.lat) * lim;
      r.pos.x -= s.n.x * corr;
      r.pos.z -= s.n.z * corr;
      r.lat -= corr;
    }
  }

  const targetY = onRoad || elevated ? s.p.y : 0;
  r.pos.y = THREE.MathUtils.lerp(r.pos.y, targetY, 1 - Math.pow(0.0001, delta));
}

// tanks push each other instead of bouncing
function resolveContacts(race: Race) {
  const rs = race.racers;
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i];
      const b = rs[j];
      let dx = b.pos.x - a.pos.x;
      let dz = b.pos.z - a.pos.z;
      let d = Math.hypot(dx, dz);
      const min = RACER_R * 2;
      if (d >= min) continue;
      if (d < 1e-4) {
        dx = Math.cos(a.id * 2.3);
        dz = Math.sin(a.id * 2.3);
        d = 1;
      }
      const nx = dx / d;
      const nz = dz / d;
      const overlap = min - d;

      // whoever is driving into the other does the pushing
      const aInto = Math.sin(a.yaw) * nx + Math.cos(a.yaw) * nz;
      const bInto = -(Math.sin(b.yaw) * nx + Math.cos(b.yaw) * nz);
      const aPush = Math.max(0, aInto) * Math.max(0, a.speed);
      const bPush = Math.max(0, bInto) * Math.max(0, b.speed);
      const total = aPush + bPush;
      // the pusher barely moves, the pushed one is shoved along
      const aShare = total > 0.1 ? bPush / total : 0.5;
      const bShare = total > 0.1 ? aPush / total : 0.5;

      a.pos.x -= nx * overlap * aShare;
      a.pos.z -= nz * overlap * aShare;
      b.pos.x += nx * overlap * bShare;
      b.pos.z += nz * overlap * bShare;

      // momentum transfer: pushed tank is dragged up towards the pusher's speed
      if (aPush > bPush + 0.2) {
        b.speed = Math.max(b.speed, a.speed * 0.9);
        a.speed *= 0.94;
      } else if (bPush > aPush + 0.2) {
        a.speed = Math.max(a.speed, b.speed * 0.9);
        b.speed *= 0.94;
      }
      // a touch of scrub so contact costs a little time
      a.yaw += nx * 0.004 * Math.abs(a.speed) * 0.1;
      b.yaw -= nx * 0.004 * Math.abs(b.speed) * 0.1;
    }
  }
}

function rank(race: Race) {
  const sorted = [...race.racers].sort((a, b) => {
    if (a.finished && b.finished) return a.time - b.time;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return progressOf(race, b) - progressOf(race, a);
  });
  sorted.forEach((r, i) => (r.place = i + 1));
}

export function stepRace(race: Race, rawDelta: number, playerInput: Input) {
  const delta = Math.min(rawDelta, 0.05);

  if (race.status === "countdown") {
    race.countdown -= delta;
    if (race.countdown <= 0) race.status = "racing";
  }
  const live = race.status === "racing";
  if (live) race.elapsed += delta;

  for (const r of race.racers) {
    const input: Input =
      !live || r.finished
        ? { throttle: r.finished ? -0.4 : 0, steer: r.finished ? 0 : 0 }
        : r.isPlayer
          ? playerInput
          : aiInput(race, r);
    drive(race, r, input, delta);
  }

  resolveContacts(race);

  for (const r of race.racers) {
    trackConstraints(race, r, delta);
    if (live && !r.finished) checkpoints(race, r);
    r.roll = THREE.MathUtils.lerp(r.roll, -r.yawVel * 0.05, 0.1);
    r.pitch = THREE.MathUtils.lerp(r.pitch, -r.speed * 0.004, 0.08);
  }

  rank(race);

  const player = race.racers[0];
  if (race.status === "racing" && player.finished) {
    fastForward(race);
    race.status = "finished";
  }
}

/** once the player crosses the line, resolve the remaining bots' finish times */
function fastForward(race: Race) {
  const dt = 1 / 30;
  let guard = 0;
  while (race.racers.some((r) => !r.finished) && guard < 60 * 60 * 3) {
    guard++;
    race.elapsed += dt;
    for (const r of race.racers) {
      if (r.finished) continue;
      drive(race, r, aiInput(race, r), dt);
      trackConstraints(race, r, dt);
      checkpoints(race, r);
    }
  }
  rank(race);
}

export function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  return `${m}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
}

export type RaceSnapshot = {
  status: RaceStatus;
  countdown: number;
  elapsed: number;
  lap: number;
  totalLaps: number;
  place: number;
  standings: { id: number; name: string; place: number; laps: number; time: number; finished: boolean; color: string }[];
};

export function snapshot(race: Race): RaceSnapshot {
  const player = race.racers[0];
  return {
    status: race.status,
    countdown: Math.max(0, race.countdown),
    elapsed: race.elapsed,
    lap: Math.min(TOTAL_LAPS, player.laps + 1),
    totalLaps: TOTAL_LAPS,
    place: player.place,
    standings: [...race.racers]
      .sort((a, b) => a.place - b.place)
      .map((r) => ({
        id: r.id,
        name: r.name,
        place: r.place,
        laps: r.laps,
        time: r.time,
        finished: r.finished,
        color: r.colors.hull,
      })),
  };
}
