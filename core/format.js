// Number formatting shared by the UI and the AI prompt.
// INR uses the Indian convention (crore / lakh crore); others use K / M / B / T.
import { isNum } from './util.js';

const SYMBOLS = { USD: '$', INR: '₹', EUR: '€', GBP: '£', JPY: '¥' };
export const currencySymbol = (c) => SYMBOLS[c] ?? (c ? `${c} ` : '');

export function fmtMoney(v, currency = 'USD', { digits } = {}) {
  if (!isNum(v)) return '—';
  const s = currencySymbol(currency);
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (currency === 'INR') {
    if (a >= 1e12) return `${sign}${s}${(a / 1e12).toFixed(digits ?? 2)}L Cr`;
    if (a >= 1e7) return `${sign}${s}${(a / 1e7).toLocaleString('en-IN', { maximumFractionDigits: digits ?? (a >= 1e10 ? 0 : 1) })} Cr`;
    if (a >= 1e5) return `${sign}${s}${(a / 1e5).toFixed(digits ?? 1)} L`;
    return `${sign}${s}${a.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }
  if (a >= 1e12) return `${sign}${s}${(a / 1e12).toFixed(digits ?? 2)}T`;
  if (a >= 1e9) return `${sign}${s}${(a / 1e9).toFixed(digits ?? (a >= 1e11 ? 0 : 1))}B`;
  if (a >= 1e6) return `${sign}${s}${(a / 1e6).toFixed(digits ?? 1)}M`;
  if (a >= 1e3) return `${sign}${s}${(a / 1e3).toFixed(digits ?? 1)}K`;
  return `${sign}${s}${a.toFixed(digits ?? 2)}`;
}

export function fmtPrice(v, currency = 'USD') {
  if (!isNum(v)) return '—';
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return `${v < 0 ? '−' : ''}${currencySymbol(currency)}${Math.abs(v).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtCount(v) {
  if (!isNum(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

export const fmtPct = (v, d = 1) => (isNum(v) ? `${v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(d)}%` : '—');
export const fmtSignedPct = (v, d = 1) => (isNum(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(d)}%` : '—');
export const fmtPctPt = (v, d = 1) => (isNum(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(d)} pts` : '—');
export const fmtX = (v, d = 1) => (isNum(v) ? `${v.toFixed(d)}×` : '—');
export const fmtNum = (v, d = 2) => (isNum(v) ? v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }) : '—');
export const fmtDays = (v) => (isNum(v) ? `${Math.round(v)} d` : '—');

// Format by a ratio definition's `fmt` key.
export function fmtBy(fmt, v, currency) {
  switch (fmt) {
    case 'pct': return fmtPct(v);
    case 'pctpt': return fmtPctPt(v);
    case 'x': return fmtX(v, 2);
    case 'days': return fmtDays(v);
    case 'money': return fmtMoney(v, currency);
    case 'price': return fmtPrice(v, currency);
    default: return fmtNum(v);
  }
}

export function fmtDate(d) {
  if (!d) return '—';
  const t = new Date(typeof d === 'number' ? (d < 1e12 ? d * 1000 : d) : d);
  return Number.isNaN(t.getTime()) ? String(d) : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
