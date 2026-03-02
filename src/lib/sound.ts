/**
 * Medieval pixel-art style sound design.
 * Uses Web Audio API for chiptune-style music and SFX (no external files).
 */

let audioContext: AudioContext | null = null;

function getContext(): AudioContext {
  if (!audioContext) audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  return audioContext;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function noteToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

// Medieval / modal scale (A minor-ish, with a bit of dorian)
const SCALE = [0, 2, 3, 5, 7, 8, 10]; // A B C D E F G (A minor)
function scaleNote(octave: number, step: number): number {
  const semitone = 57 + octave * 12 + SCALE[step % 7];
  return noteToFreq(semitone);
}

// ─── SFX: short procedural sounds ────────────────────────────────────

export function playClick(): void {
  try {
    const ctx = getContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.06);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.start(now);
    osc.stop(now + 0.06);
  } catch {
    // ignore if audio not allowed
  }
}

export function playBuildComplete(): void {
  try {
    const ctx = getContext();
    const now = ctx.currentTime;
    const notes = [scaleNote(4, 0), scaleNote(4, 2), scaleNote(4, 4)];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, now + i * 0.08);
      gain.gain.setValueAtTime(0.1, now + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.15);
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.15);
    });
  } catch {
    //
  }
}

export function playCombat(): void {
  try {
    const ctx = getContext();
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc1.type = 'sawtooth';
    osc2.type = 'square';
    osc1.frequency.setValueAtTime(120, now);
    osc2.frequency.setValueAtTime(80, now);
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.2);
    osc2.stop(now + 0.2);
  } catch {
    //
  }
}

export function playNotification(isSuccess: boolean): void {
  try {
    const ctx = getContext();
    const now = ctx.currentTime;
    const freq = isSuccess ? scaleNote(5, 2) : scaleNote(4, 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.setValueAtTime(freq * 1.2, now + 0.05);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.start(now);
    osc.stop(now + 0.12);
  } catch {
    //
  }
}

export function playVictory(): void {
  try {
    const ctx = getContext();
    const now = ctx.currentTime;
    const melody = [0, 2, 4, 5, 7, 5, 4, 2];
    melody.forEach((step, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.setValueAtTime(scaleNote(4, step), now + i * 0.1);
      gain.gain.setValueAtTime(0.09, now + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.2);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.2);
    });
  } catch {
    //
  }
}

export function playDefeat(): void {
  try {
    const ctx = getContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(scaleNote(4, 0), now);
    osc.frequency.exponentialRampToValueAtTime(scaleNote(3, 0), now + 0.4);
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.start(now);
    osc.stop(now + 0.4);
  } catch {
    //
  }
}

export function playCityFounded(): void {
  try {
    const ctx = getContext();
    const now = ctx.currentTime;
    const notes = [0, 2, 4, 4, 7];
    notes.forEach((step, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(scaleNote(4, step), now + i * 0.09);
      gain.gain.setValueAtTime(0.11, now + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.18);
      osc.start(now + i * 0.09);
      osc.stop(now + i * 0.09 + 0.18);
    });
  } catch {
    //
  }
}

// ─── Background music: medieval chiptune loop ─────────────────────────

let musicGainNode: GainNode | null = null;
let musicOscillators: OscillatorNode[] = [];
let musicInterval: ReturnType<typeof setInterval> | null = null;

const MELODY: { t: number; step: number; oct: number }[] = [
  { t: 0, step: 0, oct: 4 }, { t: 0.25, step: 2, oct: 4 }, { t: 0.5, step: 4, oct: 4 }, { t: 0.75, step: 2, oct: 4 },
  { t: 1, step: 0, oct: 4 }, { t: 1.25, step: 4, oct: 3 }, { t: 1.5, step: 2, oct: 4 }, { t: 1.75, step: 0, oct: 4 },
  { t: 2, step: 2, oct: 4 }, { t: 2.25, step: 4, oct: 4 }, { t: 2.5, step: 5, oct: 4 }, { t: 2.75, step: 4, oct: 4 },
  { t: 3, step: 2, oct: 4 }, { t: 3.25, step: 0, oct: 4 }, { t: 3.5, step: 2, oct: 4 }, { t: 3.75, step: 0, oct: 4 },
];
const LOOP_DURATION = 4;

function playMusicStep(): void {
  if (!audioContext || !musicGainNode) return;
  const now = audioContext.currentTime;
  MELODY.forEach(({ t, step, oct }) => {
    const osc = audioContext!.createOscillator();
    const env = audioContext!.createGain();
    osc.connect(env);
    env.connect(musicGainNode!);
    osc.type = 'square';
    osc.frequency.setValueAtTime(scaleNote(oct, step), now + t);
    env.gain.setValueAtTime(0, now + t);
    env.gain.linearRampToValueAtTime(0.06, now + t + 0.02);
    env.gain.exponentialRampToValueAtTime(0.001, now + t + 0.25);
    osc.start(now + t);
    osc.stop(now + t + 0.25);
    musicOscillators.push(osc);
  });
  // Bass drone (medieval feel)
  const bass = audioContext.createOscillator();
  const bassGain = audioContext.createGain();
  bass.connect(bassGain);
  bassGain.connect(musicGainNode);
  bass.type = 'triangle';
  bass.frequency.setValueAtTime(scaleNote(2, 0), now);
  bassGain.gain.setValueAtTime(0.04, now);
  bassGain.gain.exponentialRampToValueAtTime(0.001, now + LOOP_DURATION);
  bass.start(now);
  bass.stop(now + LOOP_DURATION);
  musicOscillators.push(bass);
}

export function startMusic(): void {
  try {
    const ctx = getContext();
    if (!musicGainNode) {
      musicGainNode = ctx.createGain();
      musicGainNode.gain.value = 0.7;
      musicGainNode.connect(ctx.destination);
    }
    playMusicStep();
    musicInterval = setInterval(playMusicStep, LOOP_DURATION * 1000);
  } catch {
    //
  }
}

export function stopMusic(): void {
  if (musicInterval) {
    clearInterval(musicInterval);
    musicInterval = null;
  }
  musicOscillators = [];
}

export function resumeAudioContext(): void {
  if (audioContext?.state === 'suspended') audioContext.resume();
}
