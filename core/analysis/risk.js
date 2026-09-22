// Market risk and technical snapshot from daily prices vs the benchmark index.
import { isNum, mean, stdev, quantile } from '../util.js';

const TD = 252;

function shiftDate(date, { months = 0, years = 0 }) {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() + years, d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function valueOn(series, date, idx = 1) {
  let lo = 0;
  let hi = series.length - 1;
  let best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] <= date) { best = series[mid][idx]; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

function drawdowns(points) {
  let peak = -Infinity;
  let peakDate = null;
  let max = { dd: 0, peak: null, trough: null };
  const series = [];
  for (const [date, v] of points) {
    if (v > peak) { peak = v; peakDate = date; }
    const dd = v / peak - 1;
    if (dd < max.dd) max = { dd, peak: peakDate, trough: date };
    series.push([date, dd]);
  }
  return { max, current: series.at(-1)?.[1] ?? null, series };
}

export function computeRisk(data) {
  const px = data.prices.map((r) => [r[0], r[2]]); // adjusted close
  if (px.length < 30) return null;
  const bench = data.benchmark?.prices || [];
  const benchMap = new Map(bench);
  const last = px.at(-1);
  const rf = data.assumptions.riskFree;

  // Paired daily returns on common dates.
  const pairs = [];
  let prevS = null;
  let prevB = null;
  for (const [d, v] of px) {
    const b = benchMap.get(d);
    if (b == null) continue;
    if (prevS != null) pairs.push({ d, s: v / prevS - 1, b: b / prevB - 1 });
    prevS = v;
    prevB = b;
  }
  const stockRets = [];
  for (let i = 1; i < px.length; i++) stockRets.push(px[i][1] / px[i - 1][1] - 1);

  const window = (arr, n) => arr.slice(-n);
  const p3 = window(pairs, TD * 3);
  let beta = null;
  let correlation = null;
  if (p3.length > 60) {
    const ms = mean(p3.map((x) => x.s));
    const mb = mean(p3.map((x) => x.b));
    let cov = 0; let vb = 0; let vs = 0;
    for (const x of p3) { cov += (x.s - ms) * (x.b - mb); vb += (x.b - mb) ** 2; vs += (x.s - ms) ** 2; }
    beta = cov / vb;
    correlation = cov / Math.sqrt(vb * vs);
  }

  const vol = (n) => {
    const r = window(stockRets, n);
    return r.length > 20 ? stdev(r) * Math.sqrt(TD) : null;
  };
  const r1y = [...window(stockRets, TD)].sort((a, b) => a - b);
  const var95 = r1y.length > 50 ? quantile(r1y, 0.05) : null;
  const tail = r1y.filter((x) => x <= var95);
  const cvar95 = tail.length ? mean(tail) : null;

  const ret = (from) => {
    const a = valueOn(px, from);
    return isNum(a) && a > 0 ? last[1] / a - 1 : null;
  };
  const bRet = (from) => {
    const a = valueOn(bench, from);
    return isNum(a) && a > 0 && bench.length ? bench.at(-1)[1] / a - 1 : null;
  };
  const ann = (r, y) => (isNum(r) ? (1 + r) ** (1 / y) - 1 : null);
  const firstDate = px[0][0];
  const periods = [
    ['1M', { months: -1 }, 0], ['3M', { months: -3 }, 0], ['6M', { months: -6 }, 0],
    ['YTD', null, 0], ['1Y', { years: -1 }, 1], ['3Y', { years: -3 }, 3], ['5Y', { years: -5 }, 5], ['10Y', { years: -10 }, 10],
  ];
  const trailing = periods.map(([label, off, years]) => {
    const from = off ? shiftDate(last[0], off) : `${Number(last[0].slice(0, 4)) - 1}-12-31`;
    if (from < firstDate) return { label, stock: null, benchmark: null, annualized: years > 1 };
    let s = ret(from);
    let b = bRet(from);
    if (years > 1) { s = ann(s, years); b = ann(b, years); }
    return { label, stock: s, benchmark: b, annualized: years > 1 };
  });

  // Calendar-year returns.
  const yearly = [];
  const firstYear = Number(firstDate.slice(0, 4)) + 1;
  const lastYear = Number(last[0].slice(0, 4));
  for (let y = firstYear; y <= lastYear; y++) {
    const from = `${y - 1}-12-31`;
    const to = y === lastYear ? last[0] : `${y}-12-31`;
    const s0 = valueOn(px, from); const s1 = valueOn(px, to);
    const b0 = valueOn(bench, from); const b1 = valueOn(bench, to);
    yearly.push({
      year: y === lastYear ? `${y} YTD` : String(y),
      stock: s0 && s1 ? s1 / s0 - 1 : null,
      benchmark: b0 && b1 ? b1 / b0 - 1 : null,
    });
  }

  const dd = drawdowns(px);
  const dd3 = drawdowns(px.filter((p) => p[0] >= shiftDate(last[0], { years: -3 })));
  const cagr3 = trailing.find((t) => t.label === '3Y')?.stock;
  const vol3 = vol(TD * 3);
  const downside = window(stockRets, TD * 3).filter((r) => r < 0);
  const downDev = downside.length > 10 ? Math.sqrt(mean(downside.map((r) => r * r))) * Math.sqrt(TD) : null;

  // Up/down capture vs benchmark (3y, monthly would be standard; daily keeps it simple).
  const up = p3.filter((x) => x.b > 0);
  const dn = p3.filter((x) => x.b < 0);
  const upCapture = up.length ? mean(up.map((x) => x.s)) / mean(up.map((x) => x.b)) : null;
  const downCapture = dn.length ? mean(dn.map((x) => x.s)) / mean(dn.map((x) => x.b)) : null;

  return {
    beta, correlation,
    vol1y: vol(TD), vol3y: vol3,
    var95, cvar95,
    maxDrawdown: dd.max, currentDrawdown: dd.current, maxDrawdown3y: dd3.max,
    sharpe3y: isNum(cagr3) && vol3 ? (cagr3 - rf) / vol3 : null,
    sortino3y: isNum(cagr3) && downDev ? (cagr3 - rf) / downDev : null,
    upCapture, downCapture,
    trailing, yearly,
    drawdownSeries: dd.series.filter((_, i) => i % 5 === 0 || i === dd.series.length - 1),
    technicals: technicals(data.prices),
  };
}

export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let s = 0;
  for (let i = 0; i < values.length; i++) {
    s += values[i];
    if (i >= n) s -= values[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

function rsi(values, n = 14) {
  if (values.length <= n) return null;
  let gain = 0; let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= n; loss /= n;
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

function technicals(prices) {
  const closes = prices.map((r) => r[1]);
  const last = closes.at(-1);
  const s50 = sma(closes, 50).at(-1);
  const s200 = sma(closes, 200).at(-1);
  const yr = closes.slice(-TD);
  const hi = Math.max(...yr);
  const lo = Math.min(...yr);
  const vols = prices.slice(-50).map((r) => r[3]).filter(isNum);
  return {
    sma50: s50, sma200: s200,
    aboveSma50: isNum(s50) ? last > s50 : null,
    aboveSma200: isNum(s200) ? last > s200 : null,
    goldenCross: isNum(s50) && isNum(s200) ? s50 > s200 : null,
    rsi14: rsi(closes.slice(-300)),
    high52: hi, low52: lo,
    fromHigh: last / hi - 1,
    fromLow: last / lo - 1,
    avgVolume50: vols.length ? mean(vols) : null,
  };
}
