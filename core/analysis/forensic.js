// Quality scores and forensic red-flag detection.
import { div, growth, isNum, mean, sum } from '../util.js';

export function piotroski(annual, ratios, i, { isFinancial = false } = {}) {
  const p = annual[i];
  const q = annual[i - 1];
  if (!p || !q) return null;
  const roa = div(p.netIncome, q.totalAssets);
  const prevRoa = annual[i - 2] ? div(q.netIncome, annual[i - 2].totalAssets) : div(q.netIncome, q.totalAssets);
  const lev = (x) => div(x.longTermDebt ?? x.totalDebt, x.totalAssets);
  const sharesNow = p.sharesDiluted ?? p.sharesOutstanding;
  const sharesPrev = q.sharesDiluted ?? q.sharesOutstanding;
  const r = ratios[i];
  const rq = ratios[i - 1];

  const tests = [
    { key: 'roa', label: 'Positive return on assets', pass: isNum(roa) ? roa > 0 : null, value: roa, fmt: 'pct' },
    { key: 'cfo', label: 'Positive operating cash flow', pass: isNum(p.cfo) ? p.cfo > 0 : null, value: p.cfo, fmt: 'money' },
    { key: 'droa', label: 'Return on assets improved', pass: isNum(roa) && isNum(prevRoa) ? roa > prevRoa : null, value: isNum(roa) && isNum(prevRoa) ? roa - prevRoa : null, fmt: 'pctpt' },
    { key: 'accrual', label: 'Cash flow exceeds net income', pass: isNum(p.cfo) && isNum(p.netIncome) ? p.cfo > p.netIncome : null, value: div(p.cfo, p.netIncome), fmt: 'x' },
    { key: 'leverage', label: 'Leverage fell', pass: isNum(lev(p)) && isNum(lev(q)) ? lev(p) <= lev(q) : null, value: isNum(lev(p)) && isNum(lev(q)) ? lev(p) - lev(q) : null, fmt: 'pctpt' },
    { key: 'liquidity', label: 'Current ratio improved', pass: isFinancial ? null : isNum(r.currentRatio) && isNum(rq.currentRatio) ? r.currentRatio > rq.currentRatio : null, value: isNum(r.currentRatio) && isNum(rq.currentRatio) ? r.currentRatio - rq.currentRatio : null, fmt: 'x' },
    { key: 'dilution', label: 'No share dilution', pass: isNum(sharesNow) && isNum(sharesPrev) ? sharesNow <= sharesPrev * 1.005 : null, value: growth(sharesNow, sharesPrev), fmt: 'pct' },
    { key: 'margin', label: 'Gross margin improved', pass: isFinancial ? null : isNum(r.grossMargin) && isNum(rq.grossMargin) ? r.grossMargin > rq.grossMargin : null, value: isNum(r.grossMargin) && isNum(rq.grossMargin) ? r.grossMargin - rq.grossMargin : null, fmt: 'pctpt' },
    { key: 'turnover', label: 'Asset turnover improved', pass: isNum(r.assetTurnover) && isNum(rq.assetTurnover) ? r.assetTurnover > rq.assetTurnover : null, value: isNum(r.assetTurnover) && isNum(rq.assetTurnover) ? r.assetTurnover - rq.assetTurnover : null, fmt: 'x' },
  ];
  const scored = tests.filter((t) => t.pass !== null);
  const score = scored.filter((t) => t.pass).length;
  return { period: p.period, score, max: scored.length, tests, verdict: score / Math.max(1, scored.length) >= 7 / 9 ? 'Strong' : score / Math.max(1, scored.length) <= 3 / 9 ? 'Weak' : 'Average' };
}

export function altmanZ(p, marketCap) {
  const wc = isNum(p.currentAssets) && isNum(p.currentLiabilities) ? p.currentAssets - p.currentLiabilities : null;
  const ta = p.totalAssets;
  const tl = p.totalLiabilities ?? (isNum(ta) && isNum(p.equity) ? ta - p.equity : null);
  const parts = {
    A: div(wc, ta), B: div(p.retainedEarnings, ta), C: div(p.operatingIncome, ta), D: div(marketCap, tl), E: div(p.revenue, ta),
  };
  if (Object.values(parts).some((v) => !isNum(v))) return null;
  const z = 1.2 * parts.A + 1.4 * parts.B + 3.3 * parts.C + 0.6 * parts.D + 1.0 * parts.E;
  return { period: p.period, z, parts, zone: z > 2.99 ? 'Safe' : z >= 1.81 ? 'Grey' : 'Distress' };
}

// Beneish 8-variable M-score. Above -1.78 suggests likely earnings manipulation.
export function beneish(p, q) {
  if (!p || !q) return null;
  const dep = (x) => div(x.depreciation, (x.depreciation || 0) + (x.ppe || 0));
  const gm = (x) => div(x.grossProfit, x.revenue);
  const aq = (x) => (isNum(x.currentAssets) && isNum(x.ppe) && isNum(x.totalAssets) ? 1 - (x.currentAssets + x.ppe) / x.totalAssets : null);
  const lv = (x) => div((x.currentLiabilities || 0) + (x.longTermDebt || 0), x.totalAssets);
  const v = {
    DSRI: div(div(p.receivables, p.revenue), div(q.receivables, q.revenue)),
    GMI: div(gm(q), gm(p)),
    AQI: div(aq(p), aq(q)),
    SGI: div(p.revenue, q.revenue),
    DEPI: div(dep(q), dep(p)),
    SGAI: div(div(p.sga, p.revenue), div(q.sga, q.revenue)),
    LVGI: div(lv(p), lv(q)),
    TATA: isNum(p.netIncome) && isNum(p.cfo) ? div(p.netIncome - p.cfo, p.totalAssets) : null,
  };
  // Missing optional components default to neutral (1, or 0 for TATA) so one gap doesn't void the score.
  const missing = Object.entries(v).filter(([, x]) => !isNum(x)).map(([k]) => k);
  if (!isNum(v.SGI) || !isNum(v.TATA) || missing.length > 3) return null;
  const g = (k) => (isNum(v[k]) ? v[k] : 1);
  const m = -4.84 + 0.92 * g('DSRI') + 0.528 * g('GMI') + 0.404 * g('AQI') + 0.892 * v.SGI + 0.115 * g('DEPI') - 0.172 * g('SGAI') + 4.679 * v.TATA - 0.327 * g('LVGI');
  return { period: p.period, m, components: v, missing, zone: m > -1.78 ? 'Likely manipulator' : m > -2.22 ? 'Watch' : 'Unlikely' };
}

// Returns { flags: [...], strengths: [...] }. Severity: critical | serious | warning.
export function scanRedFlags({ annual, ratios, altman, beneishLatest, isFinancial, holdingHistory = [], market }) {
  const flags = [];
  const strengths = [];
  const n = annual.length;
  if (n < 2) return { flags, strengths };
  const last = annual[n - 1];
  const prev = annual[n - 2];
  const r = ratios[n - 1];
  const lastK = (k, count) => ratios.slice(-count).map((x) => x[k]);
  const lastA = (k, count) => annual.slice(-count).map((x) => x[k]);
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const add = (severity, title, detail, metric) => flags.push({ severity, title, detail, metric });

  // Earnings not converting to cash.
  const ni3 = sum(lastA('netIncome', 3));
  const cfo3 = sum(lastA('cfo', 3));
  if (!isFinancial && ni3 > 0 && isNum(cfo3)) {
    const conv = cfo3 / ni3;
    if (conv < 0.8) add(conv < 0.5 ? 'critical' : 'serious', 'Profits are not turning into cash', `Operating cash flow was only ${conv.toFixed(2)}× net income over the last 3 years.`, 'cfoToNetIncome');
    else if (conv > 1.1) strengths.push({ title: 'High-quality earnings', detail: `Operating cash flow was ${conv.toFixed(2)}× net income over the last 3 years.` });
  }

  if (isNum(r.accrualRatio) && r.accrualRatio > 0.1 && !isFinancial) add('serious', 'High accruals', `Sloan accrual ratio is ${pct(r.accrualRatio)} (above 10% signals earnings driven by accounting rather than cash).`, 'accrualRatio');

  // Working capital stretching faster than sales.
  const revG = growth(last.revenue, prev.revenue);
  const recG = growth(last.receivables, prev.receivables);
  const invG = growth(last.inventory, prev.inventory);
  if (isNum(revG) && isNum(recG) && recG - revG > 0.15 && last.receivables > 0.05 * last.revenue && !isFinancial) {
    add(recG - revG > 0.3 ? 'serious' : 'warning', 'Receivables growing faster than revenue', `Receivables grew ${pct(recG)} vs revenue ${pct(revG)} — customers may be paying slower or sales pulled forward.`, 'receivableDays');
  }
  if (isNum(revG) && isNum(invG) && invG - revG > 0.15 && last.inventory > 0.05 * last.revenue && !isFinancial) {
    add('warning', 'Inventory building up', `Inventory grew ${pct(invG)} vs revenue ${pct(revG)} — risk of slowing demand or write-downs.`, 'inventoryDays');
  }
  const dso = lastK('receivableDays', 4).filter(isNum);
  if (dso.length >= 3 && !isFinancial) {
    const base = mean(dso.slice(0, -1));
    if (dso.at(-1) > base * 1.25 && dso.at(-1) - base > 10) add('warning', 'Collection period lengthening', `Receivable days rose to ${dso.at(-1).toFixed(0)} from a ${base.toFixed(0)}-day average.`, 'receivableDays');
  }

  // Leverage and solvency.
  if (!isFinancial) {
    if (isNum(r.netDebtToEbitda) && r.netDebtToEbitda > 3) add(r.netDebtToEbitda > 5 ? 'critical' : 'serious', 'Heavy debt load', `Net debt is ${r.netDebtToEbitda.toFixed(1)}× EBITDA.`, 'netDebtToEbitda');
    if (isNum(r.interestCoverage) && r.interestCoverage < 3) add(r.interestCoverage < 1.5 ? 'critical' : 'serious', 'Thin interest coverage', `Operating income covers interest only ${r.interestCoverage.toFixed(1)}×.`, 'interestCoverage');
    const debtG = growth(last.totalDebt, annual[Math.max(0, n - 4)].totalDebt);
    const revG3 = growth(last.revenue, annual[Math.max(0, n - 4)].revenue);
    if (isNum(debtG) && isNum(revG3) && debtG > 0.5 && debtG > revG3 * 2 && last.totalDebt > 0.2 * (last.equity || Infinity)) add('warning', 'Debt rising much faster than revenue', `Debt up ${pct(debtG)} vs revenue ${pct(revG3)} over ${Math.min(3, n - 1)} years.`, 'debtToEquity');
    if (isNum(r.currentRatio) && r.currentRatio < 1) add('warning', 'Current liabilities exceed current assets', `Current ratio is ${r.currentRatio.toFixed(2)}.`, 'currentRatio');
    if (isNum(r.netDebt) && r.netDebt < 0) strengths.push({ title: 'Net cash balance sheet', detail: 'Cash and short-term investments exceed total debt.' });
  }
  if (last.equity != null && last.equity < 0) add('serious', 'Negative shareholder equity', 'Liabilities exceed assets (often from buybacks — check whether it is financial distress or capital returns).', 'equity');

  // Cash generation.
  const fcf3 = lastA('fcf', 3).filter(isNum);
  if (!isFinancial && fcf3.length === 3 && fcf3.filter((x) => x < 0).length >= 2) add('warning', 'Burning cash', 'Free cash flow was negative in at least 2 of the last 3 years.', 'fcfMargin');
  const fcfAll = annual.map((p) => p.fcf).filter(isNum);
  if (!isFinancial && fcfAll.length >= 5 && fcfAll.every((x) => x > 0)) strengths.push({ title: 'Consistently cash generative', detail: `Positive free cash flow in all ${fcfAll.length} years on record.` });

  // Margins.
  const gm = lastK('grossMargin', 4).filter(isNum);
  if (!isFinancial && gm.length === 4 && gm[1] < gm[0] && gm[2] < gm[1] && gm[3] < gm[2] && gm[0] - gm[3] > 0.02) add('warning', 'Gross margin shrinking 3 years running', `Gross margin fell from ${pct(gm[0])} to ${pct(gm[3])} — pricing power may be weakening.`, 'grossMargin');

  const roic = ratios.map((x) => x.roic).filter(isNum);
  if (roic.length >= 5 && roic.slice(-5).every((x) => x > 0.15)) strengths.push({ title: 'Durable high returns on capital', detail: `ROIC above 15% in each of the last 5 years (latest ${pct(roic.at(-1))}) — a sign of a moat.` });
  const roe = ratios.map((x) => x.roe).filter(isNum);
  if (isFinancial && roe.length >= 3 && roe.slice(-3).every((x) => x > 0.15)) strengths.push({ title: 'Strong return on equity', detail: `ROE above 15% for 3 straight years (latest ${pct(roe.at(-1))}).` });

  // Dilution and stock compensation.
  if (isNum(r.shareCountChange) && r.shareCountChange > 0.03) add('warning', 'Shareholders being diluted', `Share count grew ${pct(r.shareCountChange)} last year.`, 'shareCountChange');
  const shares = annual.map((p) => p.sharesDiluted ?? p.sharesOutstanding).filter(isNum);
  if (shares.length >= 4 && shares.at(-1) < shares.at(-4) * 0.97) strengths.push({ title: 'Shrinking share count', detail: `Diluted shares down ${pct(1 - shares.at(-1) / shares.at(-4))} over 3 years through buybacks.` });
  if (isNum(r.sbcToRevenue) && r.sbcToRevenue > 0.1) add('warning', 'Heavy stock-based compensation', `Stock comp is ${pct(r.sbcToRevenue)} of revenue — a real cost that adjusted earnings often exclude.`, 'sbcToRevenue');

  // Payouts beyond means.
  const payouts = lastK('payoutRatio', 3).filter(isNum);
  if (payouts.filter((x) => x > 1).length >= 2) add('warning', 'Dividends exceed free cash flow', 'Dividends were larger than free cash flow in 2 of the last 3 years — funded by debt or reserves.', 'payoutRatio');

  // Tax and intangibles.
  const tax = lastK('effectiveTaxRate', 2);
  if (isNum(tax[0]) && isNum(tax[1]) && Math.abs(tax[1] - tax[0]) > 0.1) add('warning', 'Tax rate swung sharply', `Effective tax rate moved from ${pct(tax[0])} to ${pct(tax[1])} — check for one-offs flattering earnings.`, 'effectiveTaxRate');
  if (isNum(r.intangiblesToAssets) && r.intangiblesToAssets > 0.4) add('warning', 'Balance sheet heavy in goodwill', `Goodwill and intangibles are ${pct(r.intangiblesToAssets)} of assets — impairment risk from past acquisitions.`, 'intangiblesToAssets');

  // Scores.
  if (!isFinancial && altman && altman.zone === 'Distress') add('critical', 'Altman Z-score in distress zone', `Z = ${altman.z.toFixed(2)} (below 1.81 indicates elevated bankruptcy risk).`, 'altman');
  if (!isFinancial && beneishLatest && beneishLatest.zone === 'Likely manipulator') {
    // The model over-weights sales growth; hypergrowth companies trip it routinely.
    const hyper = beneishLatest.components.SGI > 1.4;
    add(hyper ? 'warning' : 'serious', 'Beneish M-score flags possible earnings manipulation',
      `M = ${beneishLatest.m.toFixed(2)} (above −1.78).${hyper ? ` Sales grew ${pct(beneishLatest.components.SGI - 1)}, which inflates the score — check receivables and accruals before reading much into it.` : ''}`, 'beneish');
  }

  // Insider / promoter holding trend (history accumulates in the daily pipeline).
  const h = holdingHistory.filter((x) => isNum(x.insidersPct));
  if (h.length >= 2) {
    const drop = h[0].insidersPct - h.at(-1).insidersPct;
    const who = market === 'IN' ? 'Promoter/insider' : 'Insider';
    if (drop > 0.02) add(drop > 0.05 ? 'serious' : 'warning', `${who} holding falling`, `${who} stake fell from ${pct(h[0].insidersPct)} to ${pct(h.at(-1).insidersPct)} since ${h[0].date}.`, 'insidersPct');
  }

  const order = { critical: 0, serious: 1, warning: 2 };
  flags.sort((a, b) => order[a.severity] - order[b.severity]);
  return { flags, strengths };
}

// Market cap at each fiscal year-end, from the price series (for historical Altman Z).
export function priceOn(prices, date) {
  let lo = 0;
  let hi = prices.length - 1;
  let best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (prices[mid][0] <= date) { best = prices[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return best ? best[1] : null;
}

