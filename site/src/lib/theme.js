import { useEffect, useState } from 'react';

// Chart colours are read from the CSS tokens so light/dark stay in one place.
const VARS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 'text', 'text-2', 'muted', 'grid', 'axis', 'surface',
  'neutral-mark', 'good', 'warning', 'serious', 'critical', 'accent', 'div-pos', 'div-neg', 'div-mid'];

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  for (const v of VARS) out[v.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = cs.getPropertyValue(`--${v}`).trim();
  out.series = [out.s1, out.s2, out.s3, out.s4, out.s5, out.s6, out.s7, out.s8];
  return out;
}

export function useColors() {
  const [colors, setColors] = useState(readColors);
  useEffect(() => {
    const update = () => setColors(readColors());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { mq.removeEventListener('change', update); obs.disconnect(); };
  }, []);
  return colors;
}

// Mix a hex colour toward another (for heat-map cells).
export function mix(hexA, hexB, t) {
  const p = (h) => h.replace('#', '').match(/.{2}/g).map((x) => parseInt(x, 16));
  try {
    const a = p(hexA);
    const b = p(hexB);
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return hexA;
  }
}

export function luminance(hex) {
  try {
    const [r, g, b] = hex.replace('#', '').match(/.{2}/g).map((x) => parseInt(x, 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  } catch {
    return 1;
  }
}
