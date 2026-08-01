// Lightweight WebAudio synth for retro/synthwave arcade SFX.
// No assets — everything is generated procedurally on demand.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Call from a user gesture so the audio context is allowed to start. */
export function unlockAudio() {
  ac();
}

function noiseBuffer(a: AudioContext, seconds: number) {
  const len = Math.floor(a.sampleRate * seconds);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function tone(
  a: AudioContext,
  type: OscillatorType,
  freq: number,
  dur: number,
  gain: number,
  endFreq?: number,
  delay = 0,
) {
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (endFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master!);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(a: AudioContext, dur: number, gain: number, hp: number, lp: number, delay = 0) {
  const t = a.currentTime + delay;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a, dur + 0.05);
  const hpf = a.createBiquadFilter();
  hpf.type = "highpass";
  hpf.frequency.value = hp;
  const lpf = a.createBiquadFilter();
  lpf.type = "lowpass";
  lpf.frequency.value = lp;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(hpf).connect(lpf).connect(g).connect(master!);
  src.start(t);
  src.stop(t + dur + 0.05);
}

// simple throttle so dense collisions don't machine-gun
const lastPlayed: Record<string, number> = {};
function throttled(key: string, ms: number) {
  const now = performance.now();
  if (lastPlayed[key] && now - lastPlayed[key] < ms) return false;
  lastPlayed[key] = now;
  return true;
}

/** Punchy electronic snare / crash for bumper hits. */
export function sfxBumper() {
  const a = ac();
  if (!a || !throttled("bumper", 45)) return;
  noise(a, 0.16, 0.5, 1200, 9000);
  tone(a, "square", 420, 0.12, 0.18, 140);
}

/** Short metallic click/clack for wall & obstacle rebounds. */
export function sfxClack(strength = 1) {
  const a = ac();
  if (!a || !throttled("clack", 40)) return;
  const g = Math.min(0.28, 0.08 + strength * 0.18);
  noise(a, 0.05, g, 2500, 12000);
  tone(a, "triangle", 900 + Math.random() * 250, 0.05, g * 0.5, 500);
}

/** Mechanical thunk/snap when a flipper fires. */
export function sfxFlipper() {
  const a = ac();
  if (!a || !throttled("flipper", 60)) return;
  tone(a, "square", 180, 0.07, 0.22, 70);
  noise(a, 0.06, 0.2, 300, 3000);
}

/** Plunger launch whoosh. */
export function sfxLaunch() {
  const a = ac();
  if (!a) return;
  tone(a, "sawtooth", 120, 0.35, 0.2, 900);
  noise(a, 0.3, 0.15, 600, 6000);
}

/** Descending synthwave arpeggio + thud on ball drain / game over. */
export function sfxDrain(gameOver = false) {
  const a = ac();
  if (!a) return;
  const notes = gameOver ? [660, 550, 440, 330, 220, 165] : [440, 330, 247];
  notes.forEach((f, i) => tone(a, "sawtooth", f, 0.22, 0.16, f * 0.9, i * 0.09));
  const thudAt = notes.length * 0.09 + 0.05;
  tone(a, "sine", 110, 0.4, 0.35, 35, thudAt);
  noise(a, 0.25, 0.18, 60, 600, thudAt);
}
