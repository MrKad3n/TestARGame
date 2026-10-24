// Shared tuning values.
// The fire game works in screen pixels; here everything is in metres.
// S converts "fire game pixels" to metres (a 25px flame ball becomes a 3.5cm radius sphere).
export const S = 0.0014;

// Physics runs on a fixed 60Hz step, exactly like the fire game's per-frame update,
// so the original constants (2% shrink/frame, 0.985 speed decay...) behave the same
// on a 72/90/120Hz headset.
export const STEP = 1 / 60;

// The three knobs from the fire game's top-left inputs.
export const CFG = {
  compression: 200,   // fire game "compression-meter": higher = gentler push between overlapping particles
  changeRate: 4,     // fire game "change-rate": overlaps needed per colour stage (red > yellow > blue > white)
  burst: 8,           // fire game "particlesPerClick": particles per emit tick
  burstInterval: 0.1, // seconds between emit ticks (fire game used 100ms)
  actionInterval: 0.1,// seconds between empower / redirect / cool ticks (also 100ms in the fire game)
  maxParticles: 450,
  gravity: 2.0,       // m/s^2 for water (game-feel value, real gravity makes water too hard to herd)
  floorY: 0,
  reach: 0.8,         // empower / cool only affect particles within this distance of the hand
  aimDistance: 1.4,   // how far in front of a palm / controller the "redirect" target sits
};

export function loadCfgFromUrl() {
  if (typeof location === 'undefined') return;
  const q = new URLSearchParams(location.search);
  const num = (k, key) => { const v = parseFloat(q.get(k)); if (!Number.isNaN(v) && v > 0) CFG[key] = v; };
  num('compression', 'compression');
  num('rate', 'changeRate');
  num('burst', 'burst');
  num('max', 'maxParticles');
  num('gravity', 'gravity');
}
