// Thesis tracker: evaluates the KPIs you wrote down against the latest data.
import { isNum } from '../util.js';

// Metrics a KPI can reference. `get` reads from the analysis object; `series`
// (optional) returns the per-year history for "every year" checks.
export const THESIS_METRICS = {
  revenueGrowth: { label: 'Revenue growth (latest year)', fmt: 'pct', get: (a) => a.latest.revenueGrowth, series: (a) => a.ratios.map((r) => r.revenueGrowth) },
  epsGrowth: { label: 'EPS growth (latest year)', fmt: 'pct', get: (a) => a.latest.epsGrowth, series: (a) => a.ratios.map((r) => r.epsGrowth) },
  revenueCagr3y: { label: 'Revenue CAGR (3y)', fmt: 'pct', get: (a) => a.growth.revenue['3y'] ?? a.growth.revenue.full },
  epsCagr3y: { label: 'EPS CAGR (3y)', fmt: 'pct', get: (a) => a.growth.eps['3y'] ?? a.growth.eps.full },
  grossMargin: { label: 'Gross margin', fmt: 'pct', get: (a) => a.latest.grossMargin, series: (a) => a.ratios.map((r) => r.grossMargin) },
  operatingMargin: { label: 'Operating margin', fmt: 'pct', get: (a) => a.latest.operatingMargin, series: (a) => a.ratios.map((r) => r.operatingMargin) },
  netMargin: { label: 'Net margin', fmt: 'pct', get: (a) => a.latest.netMargin, series: (a) => a.ratios.map((r) => r.netMargin) },
  fcfMargin: { label: 'FCF margin', fmt: 'pct', get: (a) => a.latest.fcfMargin, series: (a) => a.ratios.map((r) => r.fcfMargin) },
  roe: { label: 'Return on equity', fmt: 'pct', get: (a) => a.latest.roe, series: (a) => a.ratios.map((r) => r.roe) },
  roic: { label: 'Return on invested capital', fmt: 'pct', get: (a) => a.latest.roic, series: (a) => a.ratios.map((r) => r.roic) },
  debtToEquity: { label: 'Debt / equity', fmt: 'x', get: (a) => a.latest.debtToEquity, series: (a) => a.ratios.map((r) => r.debtToEquity) },
  netDebtToEbitda: { label: 'Net debt / EBITDA', fmt: 'x', get: (a) => a.latest.netDebtToEbitda },
  interestCoverage: { label: 'Interest coverage', fmt: 'x', get: (a) => a.latest.interestCoverage },
  currentRatio: { label: 'Current ratio', fmt: 'x', get: (a) => a.latest.currentRatio },
  cfoToNetIncome: { label: 'Operating cash flow / net income', fmt: 'x', get: (a) => a.latest.cfoToNetIncome, series: (a) => a.ratios.map((r) => r.cfoToNetIncome) },
  receivableDays: { label: 'Receivable days', fmt: 'days', get: (a) => a.latest.receivableDays },
  shareCountChange: { label: 'Share count change', fmt: 'pct', get: (a) => a.latest.shareCountChange },
  piotroski: { label: 'Piotroski F-score', fmt: 'num', get: (a) => a.piotroski?.score },
  altmanZ: { label: 'Altman Z-score', fmt: 'num', get: (a) => a.altman?.z },
  beneishM: { label: 'Beneish M-score', fmt: 'num', get: (a) => a.beneish?.m },
  redFlags: { label: 'Serious/critical red flags', fmt: 'num', get: (a) => a.redFlags.flags.filter((f) => f.severity !== 'warning').length },
  insidersPct: { label: 'Insider / promoter holding', fmt: 'pct', get: (a, d) => d.holders?.insidersPct },
  price: { label: 'Share price', fmt: 'num', get: (a, d) => d.quote.price },
  trailingPE: { label: 'P/E (trailing)', fmt: 'x', get: (a, d) => d.quote.trailingPE },
  upsideToBase: { label: 'Upside to base-case DCF', fmt: 'pct', get: (a) => a.valuation?.upside },
  impliedGrowth: { label: 'Growth implied by price (reverse DCF)', fmt: 'pct', get: (a) => a.valuation?.reverse?.impliedGrowth },
  fromHigh: { label: 'Distance from 52-week high', fmt: 'pct', get: (a) => a.risk?.technicals?.fromHigh },
};

const OPS = {
  '>': (x, v) => x > v, '>=': (x, v) => x >= v, '<': (x, v) => x < v, '<=': (x, v) => x <= v,
};

// kpi: { name?, metric, op, value, years? }  years>1 => must hold in each of the last N years.
export function evaluateThesis(thesis, analysis, data) {
  if (!thesis || !Array.isArray(thesis.kpis)) return null;
  const results = thesis.kpis.map((k) => {
    const m = THESIS_METRICS[k.metric];
    const test = OPS[k.op];
    if (!m || !test || !isNum(Number(k.value))) return { ...k, status: 'unknown', note: 'Unknown metric or operator' };
    const target = Number(k.value);
    const years = Number(k.years) || 1;
    if (years > 1 && m.series) {
      const vals = m.series(analysis).slice(-years);
      if (vals.length < years || vals.some((v) => !isNum(v))) return { ...k, label: m.label, fmt: m.fmt, status: 'unknown', actual: null, history: vals };
      const ok = vals.every((v) => test(v, target));
      return { ...k, label: m.label, fmt: m.fmt, status: ok ? 'ok' : 'broken', actual: vals.at(-1), history: vals };
    }
    const actual = m.get(analysis, data);
    if (!isNum(actual)) return { ...k, label: m.label, fmt: m.fmt, status: 'unknown', actual: null };
    return { ...k, label: m.label, fmt: m.fmt, status: test(actual, target) ? 'ok' : 'broken', actual };
  });
  const known = results.filter((r) => r.status !== 'unknown');
  const broken = known.filter((r) => r.status === 'broken').length;
  const status = !known.length ? 'unknown' : broken === 0 ? 'intact' : broken / known.length >= 0.5 ? 'broken' : 'at-risk';
  return { status, broken, total: known.length, results };
}
