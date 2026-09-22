// Runs every analysis engine over a raw research dataset.
import { computeRatios, growthSummary, isFinancialCompany, dupont } from './ratios.js';
import { piotroski, altmanZ, beneish, scanRedFlags, priceOn } from './forensic.js';
import { computeRisk } from './risk.js';
import { valuationSummary } from './valuation.js';
import { evaluateThesis } from './thesis.js';

export function analyze(data, { thesis = null } = {}) {
  const annual = data.annual || [];
  const isFinancial = isFinancialCompany(data.profile);
  const ratios = computeRatios(annual, { taxRate: data.assumptions.taxRate });
  const latest = ratios.at(-1) || {};
  const growth = growthSummary(annual, ratios);

  const piotroskiHistory = annual.map((_, i) => (i > 0 ? piotroski(annual, ratios, i, { isFinancial }) : null)).filter(Boolean);

  // Altman Z per year, using market cap at each fiscal year-end (latest uses live market cap).
  const altmanHistory = isFinancial ? [] : annual.map((p, i) => {
    const shares = p.sharesOutstanding ?? p.sharesDiluted;
    const mcap = i === annual.length - 1 && data.quote.marketCap ? data.quote.marketCap : (priceOn(data.prices, p.period) ?? null) * shares;
    return Number.isFinite(mcap) ? altmanZ(p, mcap) : null;
  }).filter(Boolean);
  const beneishHistory = isFinancial ? [] : annual.map((p, i) => (i > 0 ? beneish(p, annual[i - 1]) : null)).filter(Boolean);

  const risk = computeRisk(data);
  const base = {
    isFinancial, ratios, latest, growth, dupont: dupont(ratios), risk,
    piotroski: piotroskiHistory.at(-1) || null, piotroskiHistory,
    altman: altmanHistory.at(-1) || null, altmanHistory,
    beneish: beneishHistory.at(-1) || null, beneishHistory,
  };
  base.redFlags = scanRedFlags({
    annual, ratios, altman: base.altman, beneishLatest: base.beneish, isFinancial,
    holdingHistory: data.holdingHistory || [], market: data.market,
  });
  base.valuation = annual.length ? valuationSummary(data, base) : null;
  base.thesis = thesis ? evaluateThesis(thesis, base, data) : null;
  base.score = scorecard(base, data);
  return base;
}

// 0-100 sub-scores for the at-a-glance scorecard.
function scorecard(a, data) {
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const r = a.latest;
  const n = (x) => (Number.isFinite(x) ? x : null);
  const parts = {};
  const avg = (xs) => {
    const v = xs.filter((x) => x != null);
    return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 100) : null;
  };
  parts.growth = avg([
    n(a.growth.revenue['3y'] ?? a.growth.revenue.full) != null ? clamp01((a.growth.revenue['3y'] ?? a.growth.revenue.full) / 0.2) : null,
    n(a.growth.eps['3y'] ?? a.growth.eps.full) != null ? clamp01((a.growth.eps['3y'] ?? a.growth.eps.full) / 0.2) : null,
  ]);
  parts.profitability = avg([
    n(r.roe) != null ? clamp01(r.roe / 0.25) : null,
    !a.isFinancial && n(r.roic) != null ? clamp01(r.roic / 0.2) : null,
    !a.isFinancial && n(r.operatingMargin) != null ? clamp01(r.operatingMargin / 0.3) : null,
  ]);
  parts.health = avg([
    a.piotroski ? a.piotroski.score / Math.max(1, a.piotroski.max) : null,
    a.altman ? clamp01((a.altman.z - 1.2) / 2.5) : null,
    !a.isFinancial && n(r.interestCoverage) != null ? clamp01(r.interestCoverage / 10) : null,
    clamp01(1 - a.redFlags.flags.reduce((s, f) => s + (f.severity === 'critical' ? 0.4 : f.severity === 'serious' ? 0.2 : 0.07), 0)),
  ]);
  const up = a.valuation?.upside;
  parts.value = avg([
    n(up) != null ? clamp01((up + 0.5) / 1) : null,
    a.valuation?.multiples?.stats?.pe ? clamp01(1 - a.valuation.multiples.stats.pe.percentile) : null,
    n(a.valuation?.monteCarlo?.probAbovePrice),
  ]);
  const tr = a.risk?.trailing?.find((t) => t.label === '1Y');
  parts.momentum = avg([
    tr && n(tr.stock) != null && n(tr.benchmark) != null ? clamp01((tr.stock - tr.benchmark + 0.3) / 0.6) : null,
    a.risk?.technicals?.aboveSma200 == null ? null : a.risk.technicals.aboveSma200 ? 1 : 0,
  ]);
  return parts;
}
