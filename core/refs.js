// Citation references: stable names for every number the engine produces, so an
// AI report can cite them as [text](#ref=<ref>) and a deterministic checker can
// verify each cited figure against the data.
//
// Grammar (optionally prefixed "SYMBOL:" to cite another company):
//   quote.<field> | quote.ttm.<field>
//   fin.FY2025.<field> | fin.Q2026-06.<field>       statement line items
//   ratio.FY2025.<key> | ratio.latest.<key>         ratios (see RATIO_DEFS)
//   growth.<revenue|netIncome|eps|fcf|bookValuePerShare|dividends>.<3y|5y|10y|full>
//   score.<piotroski|piotroskiMax|altman|beneish|growth|profitability|health|value|momentum>
//   val.<bear|base|bull|upside|impliedGrowth|terminalShare|graham|justifiedPB|justifiedPBMultiple|atMeanPE|analystTarget>
//   val.inputs.<growth|discountRate|terminalGrowth|baseCashFlow|netDebt|shares>
//   val.mc.<p10|p25|p50|p75|p90|mean|probAbove>
//   val.<pe|ps|pb|pfcf|evEbitda>.<current|mean|sd|median|min|max|percentile>
//   risk.<beta|correlation|vol1y|vol3y|var95|cvar95|maxDrawdown|maxDrawdown3y|currentDrawdown|sharpe3y|sortino3y|upCapture|downCapture>
//   risk.ret.<1M|3M|6M|YTD|1Y|3Y|5Y|10Y> | risk.bench.<same> | risk.tech.<field>
//   peer[SYMBOL].<field>
//   holders.<insidersPct|institutionsPct|institutionsCount>
//   est.<0q|+1q|0y|+1y>.<growth|epsAvg|revenueAvg|revenueGrowth>
//   flags.<count|critical|serious|warning>
//   dcf[g=0.08,r=0.10,tg=0.03,model=fcf,base=...,years=5,fade=5].<perShare|upside|enterpriseValue|equityValue|terminalShare|impliedGrowth|growth|discountRate|terminalGrowth|baseCashFlow>
//   filing.<business|risk|mdna>[@N]   (text quote from the latest — or Nth previous — 10-K)
import { FIELDS } from './fields.js';
import { RATIO_DEFS } from './analysis/ratios.js';
import { dcf, reverseDcf, ttmFcf } from './analysis/valuation.js';
import { filingUrl } from './sources/sec.js';
import { fmtMoney, fmtPrice, fmtPct, fmtX, fmtNum, fmtDays, fmtCount } from './format.js';
import { isNum } from './util.js';

export const periodLabel = (p, freq) => (freq === 'annual' ? `FY${p.fy}` : `Q${p.period.slice(0, 7)}`);

export function formatValue(v, fmt, currency) {
  if (fmt === 'text') return String(v);
  if (!isNum(v)) return '—';
  switch (fmt) {
    case 'money': return fmtMoney(v, currency);
    case 'price': return fmtPrice(v, currency);
    case 'pct': return fmtPct(v);
    case 'x': return fmtX(v, 2);
    case 'days': return fmtDays(v);
    case 'count': return fmtCount(v);
    default: return fmtNum(v, 2);
  }
}

const QUOTE_FMT = {
  price: 'price', previousClose: 'price', change: 'price', changePct: 'pct', marketCap: 'money', enterpriseValue: 'money',
  sharesOutstanding: 'count', dividendYield: 'pct', payoutRatio: 'pct', fiftyTwoWeekHigh: 'price', fiftyTwoWeekLow: 'price',
  targetMean: 'price', targetHigh: 'price', targetLow: 'price', trailingEps: 'price', forwardEps: 'price', bookValuePerShare: 'price',
  analystCount: 'num',
  // ttm.*
  revenue: 'money', ebitda: 'money', fcf: 'money', cfo: 'money', cash: 'money', debt: 'money',
  grossMargin: 'pct', operatingMargin: 'pct', netMargin: 'pct', roe: 'pct', roa: 'pct', revenueGrowth: 'pct', earningsGrowth: 'pct',
};
const PEER_FMT = {
  price: 'price', marketCap: 'money', dividendYield: 'pct', grossMargin: 'pct', operatingMargin: 'pct', netMargin: 'pct', roe: 'pct',
  revenueGrowth: 'pct', earningsGrowth: 'pct', return1y: 'pct',
};
const RISK_PCT = new Set(['vol1y', 'vol3y', 'var95', 'cvar95', 'currentDrawdown', 'upCapture', 'downCapture']);
const TECH_FMT = { sma50: 'price', sma200: 'price', high52: 'price', low52: 'price', fromHigh: 'pct', fromLow: 'pct', rsi14: 'num', avgVolume50: 'count' };

// Splits "SYMBOL:rest" when the prefix looks like a ticker (refs themselves start lowercase).
export function splitRef(ref) {
  const m = ref.match(/^([A-Z0-9^][A-Z0-9.\-^&]*):(.+)$/);
  return m ? { symbol: m[1], ref: m[2] } : { symbol: null, ref };
}

export function parseDcfParams(str = '') {
  const out = {};
  for (const part of str.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [k, v] = part.split('=').map((s) => s.trim());
    out[k] = k === 'model' ? v : Number(v);
  }
  return out;
}

export function dcfRefPrefix(p) {
  const parts = [];
  if (isNum(p.growth)) parts.push(`g=${round4(p.growth)}`);
  if (isNum(p.discountRate)) parts.push(`r=${round4(p.discountRate)}`);
  if (isNum(p.terminalGrowth)) parts.push(`tg=${round4(p.terminalGrowth)}`);
  if (p.model) parts.push(`model=${p.model}`);
  if (isNum(p.baseCashFlow)) parts.push(`base=${Math.round(p.baseCashFlow)}`);
  if (isNum(p.highGrowthYears)) parts.push(`years=${p.highGrowthYears}`);
  if (isNum(p.fadeYears)) parts.push(`fade=${p.fadeYears}`);
  return `dcf[${parts.join(',')}]`;
}
const round4 = (x) => Math.round(x * 10000) / 10000;

// Builds DCF inputs from the default model plus overrides (g, r, tg, model, base, years, fade).
export function dcfInputs(data, a, params = {}) {
  const inp = { ...a.valuation.inputs };
  if (params.model && params.model !== inp.model) {
    inp.model = params.model;
    inp.baseCashFlow = params.model === 'earnings' ? data.annual.at(-1)?.netIncome : ttmFcf(data);
  }
  if (isNum(params.g)) inp.growth = params.g;
  if (isNum(params.r)) inp.discountRate = params.r;
  if (isNum(params.tg)) inp.terminalGrowth = params.tg;
  if (isNum(params.base)) inp.baseCashFlow = params.base;
  if (isNum(params.years)) inp.highGrowthYears = params.years;
  if (isNum(params.fade)) inp.fadeYears = params.fade;
  return inp;
}

// Resolves a (same-company) ref against a dataset + analysis.
// Returns { ok, value, fmt, label, source? } | { ok: false, error } | { ok: true, filing: { section, back } }.
export function resolveRef(ref, { data, a }) {
  let m;
  const res = (value, fmt, label, source = null) => (value == null || (typeof value === 'number' && !Number.isFinite(value))
    ? { ok: false, error: `no value for ${ref}` }
    : { ok: true, value, fmt, label, source });
  const bad = (error) => ({ ok: false, error });

  if ((m = ref.match(/^quote\.(ttm\.)?(\w+)$/))) {
    const v = m[1] ? data.quote.ttm?.[m[2]] : data.quote[m[2]];
    return res(v, QUOTE_FMT[m[2]] || 'num', `${m[1] ? 'TTM ' : ''}${m[2]}`, { kind: 'market', text: 'Yahoo Finance quote' });
  }

  if ((m = ref.match(/^fin\.(FY\d{4}|Q\d{4}-\d{2})\.(\w+)$/))) {
    const annual = m[1].startsWith('FY');
    const list = annual ? data.annual : data.quarterly;
    const p = [...list].reverse().find((x) => (annual ? `FY${x.fy}` : `Q${x.period.slice(0, 7)}`) === m[1]);
    if (!p) return bad(`no ${annual ? 'fiscal year' : 'quarter'} ${m[1]} (available: ${list.map((x) => periodLabel(x, annual ? 'annual' : 'quarterly')).join(', ')})`);
    const def = FIELDS[m[2]];
    if (!def && m[2] !== 'fcf') return bad(`unknown statement field "${m[2]}"`);
    const fmt = def?.unit === 'shares' ? 'count' : def?.unit === 'USD/shares' ? 'price' : 'money';
    const src = annual ? data.sources?.[p.period]?.[m[2]] : null;
    const source = src && data.cik
      ? { kind: 'filing', text: `${src.form} filed ${src.filed} (XBRL ${src.tag})`, url: filingUrl(data.cik, src.accn) }
      : { kind: 'data', text: annual ? data.dataSource : 'Yahoo Finance (quarterly)' };
    return res(p[m[2]], fmt, `${def?.label || 'Free cash flow'}, ${m[1]} (period ending ${p.period})`, source);
  }

  if ((m = ref.match(/^ratio\.(FY\d{4}|latest)\.(\w+)$/))) {
    const r = m[1] === 'latest' ? a.ratios.at(-1) : [...a.ratios].reverse().find((x) => `FY${x.fy}` === m[1]);
    if (!r) return bad(`no ratios for ${m[1]}`);
    if (!(m[2] in r)) return bad(`unknown ratio "${m[2]}"`);
    const fmt = RATIO_DEFS[m[2]]?.fmt || (m[2] === 'nopat' || m[2] === 'netDebt' ? 'money' : 'num');
    return res(r[m[2]], fmt === 'num' && ['eps', 'bookValuePerShare', 'fcfPerShare', 'revenuePerShare'].includes(m[2]) ? 'price' : fmt,
      `${RATIO_DEFS[m[2]]?.label || m[2]}, FY${r.fy}`, { kind: 'calc', text: 'Computed from annual statements' });
  }

  if ((m = ref.match(/^growth\.(\w+)\.(3y|5y|10y|full)$/))) {
    return res(a.growth[m[1]]?.[m[2]], 'pct', `${m[1]} CAGR (${m[2]})`, { kind: 'calc', text: 'Compound annual growth from annual statements' });
  }

  if ((m = ref.match(/^score\.(\w+)$/))) {
    const k = m[1];
    const v = k === 'piotroski' ? a.piotroski?.score : k === 'piotroskiMax' ? a.piotroski?.max : k === 'altman' ? a.altman?.z : k === 'beneish' ? a.beneish?.m : a.score?.[k];
    return res(v, 'num', `${k} score`, { kind: 'calc', text: 'Forensic / scorecard model' });
  }

  if ((m = ref.match(/^val\.(\w+)(?:\.(\w+))?$/))) {
    const v = a.valuation;
    if (!v) return bad('no valuation available');
    const [, k, sub] = m;
    const calc = { kind: 'calc', text: 'Valuation model (default assumptions)' };
    if (!sub) {
      if (['bear', 'base', 'bull'].includes(k)) return res(v.fair[k], 'price', `${k}-case DCF value per share`, calc);
      if (k === 'upside') return res(v.upside, 'pct', 'Upside to base-case DCF', calc);
      if (k === 'impliedGrowth') return res(v.reverse?.impliedGrowth, 'pct', 'Growth implied by price (reverse DCF)', calc);
      if (k === 'terminalShare') return res(v.terminalShare, 'pct', 'Terminal value share of EV', calc);
      if (k === 'graham') return res(v.graham, 'price', 'Graham number', calc);
      if (k === 'justifiedPB') return res(v.justifiedPB?.value, 'price', 'Justified P/B value', calc);
      if (k === 'justifiedPBMultiple') return res(v.justifiedPB?.pb, 'x', 'Justified P/B multiple', calc);
      if (k === 'atMeanPE') return res(v.atMeanPE, 'price', 'Value at historical mean P/E', calc);
      if (k === 'analystTarget') return res(v.analystTarget, 'price', 'Analyst mean target', { kind: 'market', text: 'Yahoo Finance consensus' });
      return bad(`unknown valuation ref "${k}"`);
    }
    if (k === 'inputs') {
      const fmt = ['growth', 'discountRate', 'terminalGrowth'].includes(sub) ? 'pct' : sub === 'shares' ? 'count' : 'money';
      return res(v.inputs[sub], fmt, `DCF input ${sub}`, calc);
    }
    if (k === 'mc') {
      if (sub === 'probAbove') return res(v.monteCarlo?.probAbovePrice, 'pct', 'Monte Carlo probability value > price', calc);
      return res(v.monteCarlo?.[sub], 'price', `Monte Carlo ${sub}`, calc);
    }
    const st = v.multiples?.stats?.[k];
    if (st) return res(st[sub], sub === 'percentile' ? 'pct' : 'x', `${k} ${sub} (own history since ${v.multiples.from})`, calc);
    return bad(`unknown valuation ref "${k}.${sub}"`);
  }

  if ((m = ref.match(/^risk\.(ret|bench|tech)\.(\w+)$/))) {
    const r = a.risk;
    if (!r) return bad('no risk data');
    if (m[1] === 'tech') return res(r.technicals?.[m[2]], TECH_FMT[m[2]] || 'num', `Technical ${m[2]}`, { kind: 'calc', text: 'Daily prices' });
    const t = r.trailing.find((x) => x.label === m[2]);
    if (!t) return bad(`unknown period "${m[2]}"`);
    return res(m[1] === 'ret' ? t.stock : t.benchmark, 'pct', `${m[1] === 'ret' ? 'Stock' : 'Benchmark'} return ${m[2]}${t.annualized ? ' (annualised)' : ''}`, { kind: 'calc', text: 'Daily adjusted prices' });
  }
  if ((m = ref.match(/^risk\.(\w+)$/))) {
    const r = a.risk;
    if (!r) return bad('no risk data');
    const k = m[1];
    const v = k === 'maxDrawdown' ? r.maxDrawdown?.dd : k === 'maxDrawdown3y' ? r.maxDrawdown3y?.dd : r[k];
    const fmt = RISK_PCT.has(k) || k.startsWith('maxDrawdown') ? 'pct' : 'num';
    return res(v, fmt, `Risk ${k}`, { kind: 'calc', text: 'Daily adjusted prices vs benchmark' });
  }

  if ((m = ref.match(/^peer\[([^\]]+)\]\.(\w+)$/))) {
    const p = data.peers?.find((x) => x.symbol === m[1].toUpperCase());
    if (!p) return bad(`peer ${m[1]} not in this dataset (peers: ${(data.peers || []).map((x) => x.symbol).join(', ')})`);
    return res(p[m[2]], PEER_FMT[m[2]] || 'num', `${p.symbol} ${m[2]}`, { kind: 'market', text: 'Yahoo Finance (TTM)' });
  }

  if ((m = ref.match(/^holders\.(\w+)$/))) {
    return res(data.holders?.[m[1]], m[1].endsWith('Pct') ? 'pct' : 'num', `Holders ${m[1]}`, { kind: 'market', text: 'Yahoo Finance holders' });
  }

  if ((m = ref.match(/^est\.(0q|\+1q|0y|\+1y)\.(\w+)$/))) {
    const t = data.estimates?.trend?.find((x) => x.period === m[1]);
    if (!t) return bad(`no estimate for ${m[1]}`);
    const fmt = m[2] === 'revenueAvg' ? 'money' : m[2] === 'epsAvg' ? 'price' : 'pct';
    return res(t[m[2]], fmt, `Consensus ${m[2]} (${m[1]})`, { kind: 'market', text: 'Yahoo Finance consensus' });
  }

  if ((m = ref.match(/^flags\.(count|critical|serious|warning)$/))) {
    const f = a.redFlags.flags;
    return res(m[1] === 'count' ? f.length : f.filter((x) => x.severity === m[1]).length, 'num', `Red flags (${m[1]})`, { kind: 'calc', text: 'Forensic rules' });
  }

  if ((m = ref.match(/^dcf\[([^\]]*)\]\.(\w+)$/))) {
    if (!a.valuation) return bad('no valuation available');
    const inp = dcfInputs(data, a, parseDcfParams(m[1]));
    const out = dcf(inp);
    if (!out) return bad('DCF invalid for these inputs (discount rate must exceed terminal growth)');
    const k = m[2];
    const calc = { kind: 'calc', text: `DCF g=${fmtPct(inp.growth)}, r=${fmtPct(inp.discountRate)}, tg=${fmtPct(inp.terminalGrowth)}` };
    if (k === 'perShare') return res(out.perShare, 'price', 'DCF value per share', calc);
    if (k === 'upside') return res(out.perShare / data.quote.price - 1, 'pct', 'DCF upside', calc);
    if (k === 'enterpriseValue' || k === 'equityValue') return res(out[k], 'money', `DCF ${k}`, calc);
    if (k === 'terminalShare') return res(out.terminalShare, 'pct', 'Terminal value share', calc);
    if (k === 'impliedGrowth') return res(reverseDcf(inp)?.impliedGrowth, 'pct', 'Implied growth at these rates', calc);
    // The assumptions themselves, so a report can cite what it assumed.
    if (['growth', 'discountRate', 'terminalGrowth'].includes(k)) return res(inp[k], 'pct', `DCF assumption ${k}`, calc);
    if (k === 'baseCashFlow') return res(inp.baseCashFlow, 'money', 'DCF starting cash flow', calc);
    return bad(`unknown DCF field "${k}"`);
  }

  if ((m = ref.match(/^filing\.(business|risk|mdna)(?:@(\d+))?$/))) {
    if (data.market !== 'US') return bad('10-K filings are only available for US companies');
    return { ok: true, fmt: 'text', filing: { section: m[1], back: Number(m[2] || 0) }, label: `10-K ${m[1]}` };
  }

  return bad(`unrecognised ref "${ref}"`);
}

// ---------------- Verification ----------------

// Parses a displayed figure such as "$416.2B", "₹7.63L Cr", "−12.5%", "1.06×", "3.2 pts".
export function parseDisplayed(text) {
  let t = String(text).trim().replace(/[−–]/g, '-').replace(/[“”"']/g, '');
  const pctPts = /\bpts?\b|percentage points?/i.test(t);
  const pct = /%/.test(t) || pctPts;
  const times = /[×]|\dx\b/i.test(t);
  let mult = 1;
  if (/l(akh)?\s*cr(ore)?\b/i.test(t)) mult = 1e12;
  else if (/\bcr(ore)?\b|\dcr\b/i.test(t)) mult = 1e7;
  else if (/\d\s*(t|tn|trillion)\b/i.test(t)) mult = 1e12;
  else if (/\d\s*(b|bn|billion)\b/i.test(t)) mult = 1e9;
  else if (/\d\s*(m|mn|million)\b/i.test(t)) mult = 1e6;
  else if (/\d\s*(k|thousand)\b/i.test(t)) mult = 1e3;
  else if (/\d\s*(l|lakh)\b/i.test(t)) mult = 1e5;
  const m = t.match(/-?\d[\d,]*(\.\d+)?/);
  if (!m) return null;
  const decimals = m[1] ? m[1].length - 1 : 0;
  let value = Number(m[0].replace(/,/g, '')) * mult;
  if (pct) value /= 100;
  const unit = (pct ? 0.01 : 1) * mult * 10 ** -decimals;
  return { value, unit, pct, times };
}

export function compareFigure(text, expected) {
  const p = parseDisplayed(text);
  if (!p) return { ok: false, reason: 'no number in link text' };
  const tol = Math.max(p.unit * 0.51, Math.abs(expected) * 0.015, 1e-9);
  if (Math.abs(p.value - expected) <= tol) return { ok: true };
  // Sign is often carried by the prose ("fell 5%"), so accept a magnitude match.
  if (Math.abs(Math.abs(p.value) - Math.abs(expected)) <= tol) return { ok: true, note: 'sign carried by text' };
  return { ok: false, reason: `text says ${p.value}, data says ${expected}` };
}

const norm = (s) => s.toLowerCase().replace(/[“”"'’‘]/g, '').replace(/\s+/g, ' ').trim();

export function quoteInText(quote, text) {
  const hay = norm(text);
  const parts = norm(quote).split(/\s*(?:…|\.\.\.)\s*/).filter((p) => p.length >= 12);
  if (!parts.length) return false;
  return parts.every((p) => hay.includes(p));
}

// Finds [text](#ref=...) citations in markdown.
export function extractCitations(md) {
  const out = [];
  const re = /\[([^\]]+)\]\(#ref=([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(md))) out.push({ text: m[1], ref: decodeURIComponent(m[2]), index: m.index });
  return out;
}

// Figures that look like data but carry no citation (heuristic, for warnings).
export function uncitedFigures(md) {
  const body = md
    .replace(/^---[\s\S]*?\n---/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\((#ref=|https?:)[^)]*\)/g, ' ')
    .replace(/`[^`]*`/g, ' ');
  const re = /(?:[$₹€£]\s?\d[\d,.]*\s?(?:L\s?Cr|Cr|[TBMK]|bn|mn)?|-?\d[\d,]*(?:\.\d+)?\s?(?:%|×|x\b|pts\b))/g;
  // Thresholds the analyst chose ("above 70%", "<= 0.85×") are not data claims.
  const threshold = /(above|below|over|under|least|most|exceeds?|beyond|within|[<>≥≤]=?)\s*$/i;
  const hits = [];
  let m;
  while ((m = re.exec(body))) {
    if (threshold.test(body.slice(Math.max(0, m.index - 14), m.index))) continue;
    hits.push(m[0].trim());
  }
  return [...new Set(hits)];
}
