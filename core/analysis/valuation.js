// Valuation lab: multi-stage DCF, reverse DCF, sensitivity grid, Monte Carlo,
// historical multiple bands, justified P/B (financials) and Graham number.
import { clamp, isNum, mean, stdev, mulberry32, normalSampler, quantile } from '../util.js';

// Trailing-twelve-month free cash flow from the last four consecutive quarters
// (Yahoo's own "free cash flow" is a levered estimate that can be far off),
// falling back to the latest fiscal year.
export function ttmFcf(data) {
  const q = data.quarterly.slice(-4);
  if (q.length === 4 && q.every((p) => isNum(p.cfo))) {
    const span = (new Date(q[3].period) - new Date(q[0].period)) / 86400000;
    if (span > 250 && span < 300) return q.reduce((s, p) => s + p.cfo - (p.capex || 0), 0);
  }
  return data.annual.at(-1)?.fcf ?? null;
}

export function defaultValuationInputs(data, a) {
  const { quote, assumptions, estimates } = data;
  const annual = data.annual;
  const last = annual.at(-1) || {};
  const isFinancial = a.isFinancial;

  const fcfs = annual.slice(-3).map((p) => p.fcf).filter(isNum);
  const avgFcf = fcfs.length ? mean(fcfs) : null;
  const ttm = ttmFcf(data);
  const netIncome = last.netIncome;
  let model = isFinancial ? 'earnings' : 'fcf';
  let baseCashFlow = isFinancial ? netIncome : isNum(ttm) && ttm > 0 ? ttm : avgFcf;
  if (!(baseCashFlow > 0)) {
    model = 'earnings';
    baseCashFlow = netIncome;
  }

  // Growth: blend of analyst +1y EPS growth and the historical CAGR of the
  // valued metric (revenue for FCF models, EPS for earnings models — per-share
  // growth is not inflated by mergers or share issuance).
  const cands = [];
  const g = a.growth;
  const hist = model === 'earnings' ? g.eps['5y'] ?? g.eps.full : g.revenue['5y'] ?? g.revenue.full;
  if (isNum(hist)) cands.push(hist);
  // Consensus is skipped when implausible (often distorted by one-off gains).
  const fwd = estimates?.trend?.find((t) => t.period === '+1y')?.growth;
  if (isNum(fwd) && fwd > -0.05 && fwd < 0.6) cands.push(fwd);
  const growth = clamp(cands.length ? mean(cands) : 0.08, 0, 0.3);

  const beta = clamp(isNum(a.risk?.beta) ? a.risk.beta : isNum(quote.beta) ? quote.beta : 1, 0.6, 2);
  const terminalGrowth = assumptions.terminalGrowth;
  let discountRate = assumptions.riskFree + beta * assumptions.equityRiskPremium;
  discountRate = Math.max(discountRate, terminalGrowth + 0.03, assumptions.riskFree + 0.02);

  const liquid = (last.cash || 0) + (last.shortTermInvestments || 0);
  const netDebt = isFinancial ? 0 : isNum(quote.ttm?.debt) && isNum(quote.ttm?.cash) ? quote.ttm.debt - quote.ttm.cash : (last.totalDebt || 0) - liquid;
  const shares = quote.sharesOutstanding || last.sharesOutstanding || last.sharesDiluted;

  return {
    model,
    baseCashFlow: round(baseCashFlow),
    growth: round4(growth),
    highGrowthYears: 5,
    fadeYears: 5,
    terminalGrowth,
    discountRate: round4(discountRate),
    netDebt: round(netDebt),
    shares,
    price: quote.price,
    beta,
  };
}

export function dcf(inp) {
  const { baseCashFlow, growth, highGrowthYears, fadeYears, terminalGrowth, discountRate, netDebt, shares } = inp;
  if (!isNum(baseCashFlow) || !(shares > 0) || discountRate <= terminalGrowth) return null;
  const flows = [];
  let cf = baseCashFlow;
  let pvSum = 0;
  const years = highGrowthYears + fadeYears;
  for (let t = 1; t <= years; t++) {
    const g = t <= highGrowthYears ? growth : growth + ((terminalGrowth - growth) * (t - highGrowthYears)) / (fadeYears + 1);
    cf *= 1 + g;
    const pv = cf / (1 + discountRate) ** t;
    pvSum += pv;
    flows.push({ year: t, growth: g, cashFlow: cf, pv });
  }
  const terminalValue = (cf * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
  const pvTerminal = terminalValue / (1 + discountRate) ** years;
  const enterpriseValue = pvSum + pvTerminal;
  const equityValue = enterpriseValue - (netDebt || 0);
  return {
    flows, pvSum, terminalValue, pvTerminal, enterpriseValue, equityValue,
    perShare: equityValue / shares,
    terminalShare: pvTerminal / enterpriseValue,
  };
}

// Growth rate (years 1-N) the current price implies, holding everything else fixed.
export function reverseDcf(inp, price = inp.price) {
  if (!isNum(price) || !(inp.baseCashFlow > 0)) return null;
  const at = (g) => dcf({ ...inp, growth: g })?.perShare;
  let lo = -0.5;
  let hi = 1.5;
  if (at(lo) > price) return { impliedGrowth: lo, bound: 'below' };
  if (at(hi) < price) return { impliedGrowth: hi, bound: 'above' };
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < price) lo = mid; else hi = mid;
  }
  return { impliedGrowth: (lo + hi) / 2, bound: null };
}

export function sensitivity(inp, { rateSteps = [-0.02, -0.01, 0, 0.01, 0.02], tgSteps = [-0.01, -0.005, 0, 0.005, 0.01] } = {}) {
  const rates = rateSteps.map((d) => inp.discountRate + d);
  const tgs = tgSteps.map((d) => inp.terminalGrowth + d);
  const grid = rates.map((r) => tgs.map((tg) => (r > tg + 0.005 ? dcf({ ...inp, discountRate: r, terminalGrowth: tg })?.perShare ?? null : null)));
  const growthRows = [-0.1, -0.05, 0, 0.05, 0.1].map((d) => inp.growth + d);
  const grid2 = growthRows.map((g) => rates.map((r) => (r > inp.terminalGrowth + 0.005 ? dcf({ ...inp, growth: g, discountRate: r })?.perShare ?? null : null)));
  return { rates, tgs, grid, growthRows, grid2 };
}

export function scenarios(inp) {
  const g = inp.growth;
  return {
    bear: { ...inp, growth: round4(Math.min(g * 0.5, g - 0.04)), discountRate: round4(inp.discountRate + 0.01), terminalGrowth: round4(inp.terminalGrowth - 0.005) },
    base: { ...inp },
    bull: { ...inp, growth: round4(Math.max(g * 1.4, g + 0.03)), discountRate: round4(inp.discountRate - 0.005), terminalGrowth: round4(inp.terminalGrowth + 0.005) },
  };
}

export function monteCarlo(inp, { runs = 4000, seed = 42, growthSd, rateSd = 0.01, tgSd = 0.005, cfSd = 0.1 } = {}) {
  const rand = mulberry32(seed);
  const z = normalSampler(rand);
  const gSd = growthSd ?? Math.max(0.03, Math.abs(inp.growth) * 0.35);
  const values = [];
  for (let i = 0; i < runs; i++) {
    const r = clamp(inp.discountRate + z() * rateSd, 0.03, 0.3);
    const tg = clamp(inp.terminalGrowth + z() * tgSd, -0.01, r - 0.01);
    const v = dcf({
      ...inp,
      growth: clamp(inp.growth + z() * gSd, -0.3, 0.8),
      discountRate: r,
      terminalGrowth: tg,
      baseCashFlow: inp.baseCashFlow * (1 + z() * cfSd),
    })?.perShare;
    if (isNum(v)) values.push(v);
  }
  values.sort((a, b) => a - b);
  if (!values.length) return null;
  const p = (q) => quantile(values, q);
  const lo = p(0.01);
  const hi = p(0.99);
  const bins = 36;
  const width = (hi - lo) / bins || 1;
  const hist = Array.from({ length: bins }, (_, i) => ({ x0: lo + i * width, x1: lo + (i + 1) * width, count: 0 }));
  for (const v of values) {
    if (v < lo || v > hi) continue;
    hist[Math.min(bins - 1, Math.floor((v - lo) / width))].count++;
  }
  const price = inp.price;
  return {
    runs: values.length,
    p10: p(0.1), p25: p(0.25), p50: p(0.5), p75: p(0.75), p90: p(0.9), mean: mean(values),
    probAbovePrice: isNum(price) ? values.filter((v) => v > price).length / values.length : null,
    hist,
    params: { growthSd: gSd, rateSd, tgSd, cfSd },
  };
}

// Month-end history of P/E, P/S, P/B, P/FCF and EV/EBITDA using the latest
// annual report available at each date (60-day filing lag to avoid look-ahead).
export function multipleHistory(data, ratios) {
  const annual = data.annual;
  const prices = data.prices;
  if (!annual.length || !prices.length) return null;
  const monthEnds = [];
  for (let i = 0; i < prices.length; i++) {
    const next = prices[i + 1];
    if (!next || next[0].slice(0, 7) !== prices[i][0].slice(0, 7)) monthEnds.push(prices[i]);
  }
  const lagged = annual.map((p, i) => ({ available: addDays(p.period, 60), p, r: ratios[i] }));
  const series = [];
  for (const [date, close] of monthEnds) {
    let rep = null;
    for (const l of lagged) if (l.available <= date) rep = l;
    if (!rep) continue;
    const { p, r } = rep;
    const shares = p.sharesOutstanding ?? p.sharesDiluted;
    series.push({
      date,
      price: close,
      pe: r.eps > 0 ? close / r.eps : null,
      ps: r.revenuePerShare > 0 ? close / r.revenuePerShare : null,
      pb: r.bookValuePerShare > 0 ? close / r.bookValuePerShare : null,
      pfcf: r.fcfPerShare > 0 ? close / r.fcfPerShare : null,
      evEbitda: p.ebitda > 0 && shares ? (close * shares + (r.netDebt || 0)) / p.ebitda : null,
    });
  }
  const stats = {};
  for (const k of ['pe', 'ps', 'pb', 'pfcf', 'evEbitda']) {
    const vals = series.map((s) => s[k]).filter(isNum);
    if (vals.length < 6) continue;
    // Trim extreme outliers (near-zero earnings years) before computing bands.
    const sorted = [...vals].sort((a, b) => a - b);
    const trimmed = sorted.slice(Math.floor(sorted.length * 0.05), Math.ceil(sorted.length * 0.95));
    const current = vals.at(-1);
    stats[k] = {
      mean: mean(trimmed), sd: stdev(trimmed), min: sorted[0], max: sorted.at(-1), median: quantile(sorted, 0.5), current,
      percentile: sorted.filter((v) => v <= current).length / sorted.length,
    };
  }
  return { series, stats, from: series[0]?.date };
}

export function justifiedPB({ roe, growth, costOfEquity, bvps }) {
  if (!isNum(roe) || !isNum(bvps) || costOfEquity <= growth) return null;
  const pb = (roe - growth) / (costOfEquity - growth);
  return { pb, value: pb * bvps };
}

export function grahamNumber(eps, bvps) {
  return eps > 0 && bvps > 0 ? Math.sqrt(22.5 * eps * bvps) : null;
}

export function valuationSummary(data, a) {
  const inputs = defaultValuationInputs(data, a);
  const sc = scenarios(inputs);
  const base = dcf(sc.base);
  const bear = dcf(sc.bear);
  const bull = dcf(sc.bull);
  const rev = reverseDcf(inputs);
  const mc = monteCarlo(inputs, { runs: 2000 });
  const mh = multipleHistory(data, a.ratios);
  const r = a.ratios.at(-1) || {};
  const price = data.quote.price;
  const eps = data.quote.trailingEps ?? r.eps;
  const bvps = data.quote.bookValuePerShare ?? r.bookValuePerShare;
  const roe3 = mean(a.ratios.slice(-3).map((x) => x.roe));
  const jpb = justifiedPB({ roe: roe3, growth: inputs.terminalGrowth, costOfEquity: inputs.discountRate, bvps });
  const meanPE = mh?.stats?.pe?.mean;
  return {
    inputs,
    scenarios: sc,
    fair: { bear: bear?.perShare ?? null, base: base?.perShare ?? null, bull: bull?.perShare ?? null },
    upside: base && isNum(price) ? base.perShare / price - 1 : null,
    terminalShare: base?.terminalShare ?? null,
    reverse: rev,
    monteCarlo: mc,
    multiples: mh,
    graham: grahamNumber(eps, bvps),
    justifiedPB: jpb,
    atMeanPE: isNum(meanPE) && eps > 0 ? meanPE * eps : null,
    analystTarget: data.quote.targetMean ?? null,
  };
}

const round = (x) => (isNum(x) ? Math.round(x) : x);
const round4 = (x) => (isNum(x) ? Math.round(x * 10000) / 10000 : x);
function addDays(d, n) {
  const t = new Date(d);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

