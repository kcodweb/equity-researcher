// Small numeric helpers shared by the pipeline, the browser and the worker.

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function div(a, b) {
  if (!isNum(a) || !isNum(b) || b === 0) return null;
  return a / b;
}

export function avg2(a, b) {
  if (isNum(a) && isNum(b)) return (a + b) / 2;
  return isNum(a) ? a : isNum(b) ? b : null;
}

export function growth(cur, prev) {
  if (!isNum(cur) || !isNum(prev) || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

// Compound annual growth; undefined when the sign flips.
export function cagr(end, start, years) {
  if (!isNum(end) || !isNum(start) || years <= 0 || start <= 0 || end <= 0) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

export function mean(xs) {
  const v = xs.filter(isNum);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

export function stdev(xs) {
  const v = xs.filter(isNum);
  if (v.length < 2) return null;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

export function sum(xs) {
  const v = xs.filter(isNum);
  return v.length ? v.reduce((s, x) => s + x, 0) : null;
}

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

// Deterministic PRNG so Monte Carlo results are stable between renders.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalSampler(rand) {
  return () => {
    let u = 0;
    while (u === 0) u = rand();
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function marketOf(symbol, currency) {
  if (/\.(NS|BO)$/i.test(symbol) || currency === 'INR') return 'IN';
  return 'US';
}

// Stable short hash (FNV-1a) used to detect changed AI-note inputs.
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
