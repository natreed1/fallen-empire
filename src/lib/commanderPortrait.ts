/**
 * Deterministic low-res "knight bust" portrait for commanders (canvas).
 * No external assets; pixel-style rectangles + a few circles.
 */

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SKIN = ['#c58c65', '#e0ac84', '#8d5524', '#5c3a2a', '#f0d0b0', '#7a5c4e'];
const HAIR = ['#1a1208', '#3d2817', '#6b4423', '#8b6914', '#2c1810', '#d4c4b0', '#0d1b2a'];
const EYE = ['#2d4a3e', '#4a3728', '#1e3a5f', '#5c4030', '#2a1810'];
const ARMOR = ['#6b7280', '#78716c', '#475569', '#92400e', '#4c1d95'];

/**
 * Renders a 48×48 data URL PNG (scaled up crisply in UI).
 */
export function renderCommanderPortraitDataUrl(seed: number): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const W = 48;
  const H = 48;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  const skin = SKIN[Math.floor(rnd() * SKIN.length)];
  const hair = HAIR[Math.floor(rnd() * HAIR.length)];
  const eye = EYE[Math.floor(rnd() * EYE.length)];
  const armor = ARMOR[Math.floor(rnd() * ARMOR.length)];
  const helmMetal = rnd() > 0.5 ? '#94a3b8' : '#cbd5e1';
  const visorDark = '#0f172a';

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 0, W, H);

  // Shoulders / torso (knight plate)
  ctx.fillStyle = armor;
  ctx.fillRect(10, 34, 28, 12);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(16, 38, 16, 4);

  // Neck
  ctx.fillStyle = skin;
  ctx.fillRect(20, 28, 8, 8);

  // Face block
  ctx.fillStyle = skin;
  ctx.fillRect(14, 14, 20, 18);

  // Helmet dome
  ctx.fillStyle = helmMetal;
  ctx.fillRect(12, 8, 24, 12);
  // Visor slit
  ctx.fillStyle = visorDark;
  ctx.fillRect(14, 12, 20, 4);
  // Helmet ridge
  ctx.fillStyle = '#64748b';
  ctx.fillRect(23, 6, 2, 8);

  // Hair peek (sides / back)
  ctx.fillStyle = hair;
  if (rnd() > 0.4) {
    ctx.fillRect(10, 12, 4, 14);
    ctx.fillRect(34, 12, 4, 14);
  }
  if (rnd() > 0.5) {
    ctx.fillRect(14, 6, 20, 4);
  }

  // Eyes (visible under visor gap)
  ctx.fillStyle = eye;
  ctx.fillRect(16, 13, 3, 2);
  ctx.fillRect(27, 13, 3, 2);

  // Nose / cheek shade
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(22, 18, 4, 3);

  // Plume / crest (sometimes)
  if (rnd() > 0.55) {
    ctx.fillStyle = hair;
    ctx.fillRect(22, 2, 4, 6);
  }

  return canvas.toDataURL('image/png');
}
