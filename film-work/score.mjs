// Original 120 BPM piano-led score for the 60-second product film.
// All event times are deterministic, so the renderer can place UI motion on the same beat grid.
import fs from 'node:fs';

const SR = 48000;
const DURATION = 60;
const N = SR * DURATION;
const left = new Float32Array(N);
const right = new Float32Array(N);
const TAU = Math.PI * 2;
const beat = 0.5;

function hz(midi) { return 440 * 2 ** ((midi - 69) / 12); }
function addPiano(t, midi, duration, velocity = 0.5, pan = 0) {
  const start = Math.round(t * SR);
  const length = Math.min(Math.round((duration + 1.2) * SR), N - start);
  if (start < 0 || length <= 0) return;
  const f = hz(midi);
  for (let i = 0; i < length; i++) {
    const x = i / SR;
    const attack = Math.min(1, x / 0.012);
    const decay = Math.exp(-x * (1.4 + 0.24 * (midi - 48) / 24));
    const release = x > duration ? Math.exp(-(x - duration) * 5.5) : 1;
    const slight = Math.sin(TAU * f * 1.002 * x) * 0.09;
    const tone = Math.sin(TAU * f * x) * 0.66
      + Math.sin(TAU * f * 2 * x) * 0.17
      + Math.sin(TAU * f * 3 * x) * 0.07 + slight;
    const sample = tone * attack * decay * release * velocity;
    left[start + i] += sample * (0.8 - pan * 0.22);
    right[start + i] += sample * (0.8 + pan * 0.22);
  }
}
function addPulse(t, pitch = 64, level = 0.06) {
  const start = Math.round(t * SR);
  for (let i = 0; i < SR * 0.18 && start + i < N; i++) {
    const x = i / SR;
    const s = Math.sin(TAU * (pitch + 60 * Math.exp(-x * 36)) * x) * Math.exp(-x * 31) * level;
    left[start + i] += s;
    right[start + i] += s;
  }
}
function addClick(t, level = 0.11) {
  const start = Math.round(t * SR);
  let seed = Math.floor(t * 10000) + 17;
  for (let i = 0; i < SR * 0.055 && start + i < N; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = (seed / 0xffffffff * 2 - 1);
    const s = noise * Math.exp(-i / SR * 110) * level;
    left[start + i] += s;
    right[start + i] += s * 0.88;
  }
}
function addImpact(t, level = 0.28) {
  const start = Math.round(t * SR);
  let seed = Math.floor(t * 10000) + 73;
  for (let i = 0; i < SR * 1.15 && start + i < N; i++) {
    const x = i / SR;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = (seed / 0xffffffff * 2 - 1);
    const boom = Math.sin(TAU * (44 + 25 * Math.exp(-x * 18)) * x) * Math.exp(-x * 5);
    const air = noise * Math.exp(-x * 14) * 0.12;
    const s = (boom + air) * level;
    left[start + i] += s;
    right[start + i] += s;
  }
}

// Harmonic arc: unresolved E minor in the problem, then G major / C major in the solution.
const chords = [
  [52, 55, 59], [48, 52, 55], [50, 54, 57], [47, 50, 54],
  [52, 55, 59], [48, 52, 55], [50, 54, 57], [47, 50, 54],
  [52, 55, 59], [50, 54, 57], [48, 52, 55],
  [55, 59, 62], [48, 52, 55], [55, 59, 62], [53, 57, 60],
  [48, 52, 55], [55, 59, 62], [52, 55, 59], [48, 52, 55],
  [55, 59, 62], [48, 52, 55], [55, 59, 62], [53, 57, 60],
  [48, 52, 55], [55, 59, 62], [48, 52, 55], [55, 59, 62],
  [48, 52, 55], [55, 59, 62], [48, 52, 55],
];
const melodyOffsets = [12, 19, 16, 12];
for (let bar = 0; bar < 30; bar++) {
  const t = bar * 2;
  const chord = chords[bar];
  const section = t < 16 ? 0 : t < 22 ? 1 : t < 56 ? 2 : 3;
  const dynamic = [0.21, 0.27, 0.30, 0.23][section];
  addPiano(t, chord[0] - 12, 1.65, dynamic * 0.83, -0.15);
  for (let b = 0; b < 4; b++) {
    const note = chord[b % 3] + melodyOffsets[(bar + b) % 4] - 12;
    addPiano(t + b * beat, note, b === 3 ? 0.9 : 0.43,
      dynamic * (b === 0 ? 0.82 : 0.52), b % 2 ? 0.24 : -0.22);
    if (section >= 1) addPulse(t + b * beat, section === 1 ? 54 : 70, section === 1 ? 0.031 : 0.019);
  }
  if (section >= 2 && bar % 2 === 0) addPiano(t, chord[2] + 12, 1.6, 0.07, 0.4);
}

// Measured beat-grid accent events shared with the visual storyboard.
for (const t of [2, 4, 8, 10, 12, 16, 17, 22, 24, 25, 26, 27, 30, 32, 36, 38, 40, 42, 44, 46, 48, 49, 50, 52, 54, 56, 58]) {
  addClick(t + 0.025, t === 22 || t === 56 ? 0.05 : 0.075);
}
addImpact(22, 0.34);
addImpact(56, 0.27);
// A restrained final cadence; the loop tail fades into the opening silence.
addPiano(56, 55, 3.1, 0.26);
addPiano(56.5, 59, 2.6, 0.19);
addPiano(57, 62, 2.2, 0.18);
addPiano(58, 67, 1.5, 0.21);

const out = Buffer.alloc(44 + N * 4);
out.write('RIFF', 0); out.writeUInt32LE(out.length - 8, 4);
out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28);
out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
out.write('data', 36); out.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  const fade = Math.min(1, i / (SR * 0.25), (N - 1 - i) / (SR * 0.65));
  const l = Math.tanh(left[i] * 1.2) * 0.82 * Math.max(0, fade);
  const r = Math.tanh(right[i] * 1.2) * 0.82 * Math.max(0, fade);
  out.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
  out.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
}
fs.writeFileSync(new URL('./score.wav', import.meta.url), out);
console.log('Wrote original 60 s / 120 BPM / 48 kHz stereo score.wav');
