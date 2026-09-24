#!/usr/bin/env node
// Research CLI — the tool layer for the AI analyst (Claude Code runs these commands).
// Every figure printed carries a citation ref; cite it in reports as [figure](#ref=<ref>).
// Run `node cli/research.js help` for usage.
import fs from 'node:fs';
import path from 'node:path';
import { createYahoo } from '../core/sources/yahoo.js';
import { createSec, htmlToText, extract10KSectionMap, annualReports, filingUrl, TENK_SECTIONS } from '../core/sources/sec.js';
import { researchTicker, fetchPeerRows } from '../core/research.js';
import { analyze } from '../core/analysis/index.js';
import { STATEMENTS, FIELDS, DERIVED_LABELS } from '../core/fields.js';
import { RATIO_DEFS } from '../core/analysis/ratios.js';
import { dcf, reverseDcf, sensitivity, monteCarlo } from '../core/analysis/valuation.js';
import { THESIS_METRICS } from '../core/analysis/thesis.js';
import {
  resolveRef, formatValue, periodLabel, splitRef, dcfInputs, dcfRefPrefix,
  extractCitations, compareFigure, quoteInText, uncitedFigures,
} from '../core/refs.js';
import { fmtMoney, fmtPct, fmtNum, fmtBy, fmtPrice } from '../core/format.js';
import { ROOT, DATA_DIR, fileKey, readJson, writeJson, loadConfig, loadThesis } from '../pipeline/config.js';

const CACHE = path.join(ROOT, '.cache');
const TTL_MS = 6 * 3600 * 1000;
const err = (m) => process.stderr.write(`${m}\n`);

let _cfg = null;
let _clients = null;
const cfg = () => (_cfg ||= loadConfig());
const clients = () => (_clients ||= {
  yahoo: createYahoo(),
  sec: createSec({ userAgent: process.env.SEC_USER_AGENT || cfg().secUserAgent }),
});
const soft = (label, fn) => fn().catch((e) => { err(`  ! ${label}: ${e.message}`); return null; });

// ---------------------------------------------------------------- helpers

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i++; } else flags[key] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

function table(headers, rows) {
  const esc = (c) => String(c ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [
    `| ${headers.map(esc).join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`),
  ].join('\n');
}

const val = (ctx, ref) => {
  const r = resolveRef(ref, ctx);
  return r.ok && r.fmt !== 'text' ? formatValue(r.value, r.fmt, ctx.data.currency) : '—';
};

// Table of [label, ref] pairs; rows without data are dropped.
function refTable(ctx, items) {
  const rows = [];
  for (const it of items.filter(Boolean)) {
    const [label, ref] = it;
    const r = resolveRef(ref, ctx);
    if (!r.ok) continue;
    rows.push([label, formatValue(r.value, r.fmt, ctx.data.currency), `\`${ref}\``]);
  }
  return rows.length ? table(['Metric', 'Value', 'Ref'], rows) : '_No data._';
}

const fmtForField = (k) => (FIELDS[k]?.unit === 'shares' ? 'count' : FIELDS[k]?.unit === 'USD/shares' ? 'price' : 'money');
const readText = (file) => fs.readFileSync(path.resolve(file), 'utf8');

// ---------------------------------------------------------------- data loading + trail

async function load(symbol, { fresh = false } = {}) {
  symbol = symbol.trim().toUpperCase();
  const file = path.join(CACHE, 'research', `${fileKey(symbol)}.json`);
  let data = fresh ? null : readJson(file);
  if (data && Date.now() - new Date(data.generatedAt).getTime() > TTL_MS) data = null;
  if (!data) {
    const entry = cfg().watchlist.find((w) => w.symbol.toUpperCase() === symbol);
    err(`Fetching ${symbol}…`);
    data = await researchTicker(symbol, { ...clients(), markets: cfg().markets, peers: entry?.peers, log: err });
    writeJson(file, data);
  }
  data.holdingHistory = readJson(path.join(DATA_DIR, 'history', `${fileKey(symbol)}.json`), []);
  const thesis = loadThesis(symbol, err);
  return { data, a: analyze(data, { thesis }), thesis, cacheFile: file };
}

const ctxCache = new Map();
async function loadCached(symbol, opts) {
  const key = symbol.toUpperCase();
  if (!ctxCache.has(key)) ctxCache.set(key, await load(key, opts));
  return ctxCache.get(key);
}

const trailFile = (symbol) => path.join(CACHE, 'trail', `${fileKey(symbol)}.jsonl`);
function recordTrail(symbol, command) {
  fs.mkdirSync(path.dirname(trailFile(symbol)), { recursive: true });
  fs.appendFileSync(trailFile(symbol), `${JSON.stringify({ ts: new Date().toISOString(), command })}\n`);
}

// 10-K section text, cached per filing.
async function filingSections(ctx, back = 0) {
  const { data } = ctx;
  if (data.market !== 'US' || !data.cik) throw new Error('SEC filings are only available for US-listed companies. For Indian companies use web search for the annual report and earnings-call transcripts.');
  const subs = await clients().sec.submissions(data.cik);
  const reports = annualReports(subs);
  const rep = reports[back];
  if (!rep) throw new Error(`No annual report ${back} back (found ${reports.length})`);
  const file = path.join(CACHE, 'filings', `${data.cik}-${rep.filed}.json`);
  let sections = readJson(file);
  if (!sections) {
    err(`Downloading ${rep.form} filed ${rep.filed}…`);
    sections = extract10KSectionMap(htmlToText(await clients().sec.document(rep.url)));
    writeJson(file, sections);
  }
  return { rep, reports, sections };
}

// ---------------------------------------------------------------- commands

const COMMANDS = {};

COMMANDS.snapshot = async (ctx) => {
  const { data: d, a } = ctx;
  const L = a.ratios.length ? `FY${a.ratios.at(-1).fy}` : null;
  const fin = a.isFinancial;
  const o = [];
  o.push(`# ${d.symbol} — ${d.profile.name}`);
  o.push(`${d.profile.exchange} · ${d.profile.sector || '?'} / ${d.profile.industry || '?'} · market ${d.market} · currency ${d.currency}`);
  o.push(`Data: ${d.dataSource} · fetched ${d.generatedAt} · ${d.annual.length} fiscal years, ${d.quarterly.length} quarters`);
  if (fin) o.push('**Financial company:** gross margin, ROIC, current ratio, Altman Z, Beneish M and FCF-based DCF are not meaningful — valuation uses earnings and P/B.');
  if (d.warnings?.length) o.push(`Warnings: ${d.warnings.join(' | ')}`);
  o.push('Cite figures as [figure](#ref=<ref>).');

  o.push('\n## Business');
  o.push((d.profile.summary || 'n/a').slice(0, 800) + ((d.profile.summary || '').length > 800 ? '…' : ''));

  o.push('\n## Market & valuation');
  o.push(refTable(ctx, [
    ['Price', 'quote.price'], ['Change today', 'quote.changePct'], ['Market cap', 'quote.marketCap'], ['Enterprise value', 'quote.enterpriseValue'],
    ['P/E (ttm)', 'quote.trailingPE'], ['P/E (forward)', 'quote.forwardPE'], ['P/B', 'quote.priceToBook'], ['P/S', 'quote.priceToSales'],
    ['EV/EBITDA', 'quote.evToEbitda'], ['Dividend yield', 'quote.dividendYield'], ['52-week high', 'quote.fiftyTwoWeekHigh'], ['52-week low', 'quote.fiftyTwoWeekLow'],
    ['Analyst mean target', 'quote.targetMean'], ['Analysts covering', 'quote.analystCount'],
  ]));
  if (d.quote.recommendation) o.push(`Consensus rating: ${d.quote.recommendation}`);

  if (L) {
    o.push(`\n## Fundamentals (latest fiscal year ${L}, period ending ${d.annual.at(-1).period})`);
    const g = a.growth;
    o.push(refTable(ctx, [
      ['Revenue', `fin.${L}.revenue`], ['Revenue growth', `ratio.${L}.revenueGrowth`],
      !fin && ['Gross margin', `ratio.${L}.grossMargin`], ['Operating margin', `ratio.${L}.operatingMargin`], ['Net margin', `ratio.${L}.netMargin`],
      ['Net income', `fin.${L}.netIncome`], ['EPS (diluted)', `ratio.${L}.eps`], ['ROE', `ratio.${L}.roe`], !fin && ['ROIC', `ratio.${L}.roic`],
      !fin && ['Free cash flow', `fin.${L}.fcf`], !fin && ['FCF margin', `ratio.${L}.fcfMargin`], !fin && ['Operating cash flow / net income', `ratio.${L}.cfoToNetIncome`],
      !fin && ['Net debt / EBITDA', `ratio.${L}.netDebtToEbitda`], !fin && ['Interest coverage', `ratio.${L}.interestCoverage`],
      ['Debt / equity', `ratio.${L}.debtToEquity`], ['Share count change', `ratio.${L}.shareCountChange`],
      ['Revenue CAGR 3y', 'growth.revenue.3y'], ['Revenue CAGR 5y', 'growth.revenue.5y'], ['Revenue CAGR 10y', 'growth.revenue.10y'],
      g.revenue['5y'] == null && ['Revenue CAGR (full history)', 'growth.revenue.full'],
      ['EPS CAGR 3y', 'growth.eps.3y'], ['EPS CAGR 5y', 'growth.eps.5y'], g.eps['5y'] == null && ['EPS CAGR (full history)', 'growth.eps.full'],
    ]));
  }

  o.push('\n## Quality & forensics');
  const q = [];
  if (a.piotroski) q.push(['Piotroski F-score', `${a.piotroski.score}/${a.piotroski.max} (${a.piotroski.verdict})`, '`score.piotroski`']);
  if (a.altman) q.push(['Altman Z-score', `${fmtNum(a.altman.z, 2)} (${a.altman.zone})`, '`score.altman`']);
  if (a.beneish) q.push(['Beneish M-score', `${fmtNum(a.beneish.m, 2)} (${a.beneish.zone})`, '`score.beneish`']);
  if (q.length) o.push(table(['Score', 'Value', 'Ref'], q));
  o.push(`Red flags (\`flags.count\` = ${a.redFlags.flags.length}):`);
  o.push(a.redFlags.flags.length ? a.redFlags.flags.map((f) => `- [${f.severity}] ${f.title} — ${f.detail}`).join('\n') : '- none triggered');
  o.push('Strengths:');
  o.push(a.redFlags.strengths.length ? a.redFlags.strengths.map((s) => `- ${s.title} — ${s.detail}`).join('\n') : '- none detected');

  if (a.valuation) {
    const v = a.valuation;
    o.push(`\n## Valuation (default ${v.inputs.model === 'fcf' ? 'free-cash-flow' : 'earnings'} DCF — run \`dcf\` to test your own assumptions)`);
    o.push(refTable(ctx, [
      ['Starting cash flow', 'val.inputs.baseCashFlow'], ['Growth yrs 1-5', 'val.inputs.growth'], ['Discount rate', 'val.inputs.discountRate'], ['Terminal growth', 'val.inputs.terminalGrowth'],
      ['Bear value / share', 'val.bear'], ['Base value / share', 'val.base'], ['Bull value / share', 'val.bull'], ['Upside to base', 'val.upside'],
      ['Growth implied by price (reverse DCF)', 'val.impliedGrowth'], ['Terminal value share of EV', 'val.terminalShare'],
      ['Monte Carlo P10', 'val.mc.p10'], ['Monte Carlo median', 'val.mc.p50'], ['Monte Carlo P90', 'val.mc.p90'], ['P(value > price)', 'val.mc.probAbove'],
      ['P/E now (own-history basis)', 'val.pe.current'], ['P/E historical mean', 'val.pe.mean'], ['P/E percentile vs own history', 'val.pe.percentile'],
      ['EV/EBITDA now', 'val.evEbitda.current'], ['EV/EBITDA historical mean', 'val.evEbitda.mean'],
      ['Value at mean P/E', 'val.atMeanPE'], ['Graham number', 'val.graham'], fin && ['Justified P/B value', 'val.justifiedPB'],
    ]));
  }

  if (a.risk) {
    o.push(`\n## Risk & returns (vs ${d.benchmark?.name || 'benchmark'})`);
    o.push(refTable(ctx, [
      ['Beta (3y)', 'risk.beta'], ['Volatility 1y', 'risk.vol1y'], ['Max drawdown (10y)', 'risk.maxDrawdown'], ['Current drawdown', 'risk.currentDrawdown'],
      ['Sharpe 3y', 'risk.sharpe3y'], ['Return 1Y', 'risk.ret.1Y'], ['Benchmark 1Y', 'risk.bench.1Y'], ['Return 3Y (ann.)', 'risk.ret.3Y'],
      ['Benchmark 3Y (ann.)', 'risk.bench.3Y'], ['Return 5Y (ann.)', 'risk.ret.5Y'], ['Benchmark 5Y (ann.)', 'risk.bench.5Y'],
    ]));
  }

  o.push('\n## Scorecard (0-100)');
  o.push(refTable(ctx, ['growth', 'profitability', 'health', 'value', 'momentum'].map((k) => [k, `score.${k}`])));

  if (a.thesis) {
    o.push(`\n## Thesis status: ${a.thesis.status.toUpperCase()} (${a.thesis.broken}/${a.thesis.total} KPIs broken)`);
    o.push(thesisTable(ctx));
  }
  if (d.peers?.length) o.push(`\n## Peers\n${d.peers.map((p) => `${p.symbol} (${p.name})`).join(', ')} — run \`peers\` for the comparison, or \`peers --peers A,B,C\` to choose better ones.`);
  o.push('\nNext: financials · ratios · forensics · valuation · dcf · risk · peers · ownership · news · filing (US) · thesis');
  return o.join('\n');
};

COMMANDS.financials = async (ctx, { flags }) => {
  const { data: d } = ctx;
  const annual = (flags.period || 'annual') !== 'quarterly';
  const freq = annual ? 'annual' : 'quarterly';
  const list = (annual ? d.annual : d.quarterly).slice(-(Number(flags.years) || (annual ? 10 : 8)));
  if (!list.length) return `No ${freq} statements available.`;
  const which = flags.statement && flags.statement !== 'all' ? [flags.statement] : ['income', 'balance', 'cashflow'];
  const o = [`# ${d.symbol} ${freq} financials (${d.currency}${d.fxRate ? `, converted from ${d.financialCurrency} at ${d.fxRate.toFixed(4)}` : ''})`];
  o.push(`Source: ${annual ? d.dataSource : 'Yahoo Finance'}. Cite as fin.<period>.<key>, e.g. fin.${periodLabel(list.at(-1), freq)}.revenue`);
  for (const s of which) {
    if (!STATEMENTS[s]) throw new Error(`--statement must be income, balance, cashflow or all`);
    const keys = STATEMENTS[s].filter((k) => list.some((p) => p[k] != null));
    o.push(`\n## ${{ income: 'Income statement', balance: 'Balance sheet', cashflow: 'Cash flow' }[s]}`);
    o.push(table(['key', 'Line item', ...list.map((p) => periodLabel(p, freq))],
      keys.map((k) => [k, FIELDS[k]?.label || DERIVED_LABELS[k] || k, ...list.map((p) => formatValue(p[k], fmtForField(k), d.currency))])));
  }
  if (annual && d.sources && d.cik) {
    o.push('\n## Source filings (SEC)');
    o.push(table(['Period', 'Form', 'Filed', 'Filing index'], list.map((p) => {
      const src = d.sources[p.period]?.revenue || d.sources[p.period]?.netIncome || Object.values(d.sources[p.period] || {})[0];
      return [periodLabel(p, freq), src?.form || '—', src?.filed || '—', src ? filingUrl(d.cik, src.accn) : '—'];
    })));
  }
  return o.join('\n');
};

COMMANDS.ratios = async (ctx, { flags }) => {
  const { data: d, a } = ctx;
  const years = a.ratios.slice(-(Number(flags.years) || 10));
  const groupFilter = flags.group ? String(flags.group).toLowerCase() : null;
  const keys = Object.entries(RATIO_DEFS).filter(([k, def]) => (!groupFilter || def.group.toLowerCase().includes(groupFilter)) && years.some((r) => r[k] != null));
  return [
    `# ${d.symbol} ratios by fiscal year — cite as ratio.<FYyyyy>.<key> (or ratio.latest.<key>)`,
    a.isFinancial ? 'Financial company: margin, ROIC and liquidity ratios are not meaningful.' : '',
    table(['key', 'Group', 'Ratio', ...years.map((r) => `FY${r.fy}`)], keys.map(([k, def]) => [k, def.group, def.label, ...years.map((r) => fmtBy(def.fmt, r[k], d.currency))])),
  ].filter(Boolean).join('\n');
};

COMMANDS.forensics = async (ctx) => {
  const { data: d, a } = ctx;
  const o = [`# ${d.symbol} quality & forensic analysis`];
  if (a.isFinancial) o.push('Financial company: Altman Z and Beneish M are not applicable; Piotroski skips liquidity and gross-margin tests.');
  if (a.piotroski) {
    o.push(`\n## Piotroski F-score: ${a.piotroski.score}/${a.piotroski.max} (${a.piotroski.verdict}) — \`score.piotroski\`, FY${a.piotroski.period.slice(0, 4)} vs prior year`);
    o.push(table(['Test', 'Result', 'Value'], a.piotroski.tests.map((t) => [t.label, t.pass == null ? 'n/a' : t.pass ? 'PASS' : 'FAIL', t.value == null ? '—' : fmtBy(t.fmt, t.value, d.currency)])));
    o.push(`History: ${a.piotroskiHistory.map((h) => `FY${h.period.slice(0, 4)} ${h.score}/${h.max}`).join(' · ')}`);
  }
  if (a.altman) {
    o.push(`\n## Altman Z-score: ${fmtNum(a.altman.z, 2)} (${a.altman.zone}; <1.81 distress, >2.99 safe) — \`score.altman\``);
    o.push(table(['Component', 'Weight', 'Value'], [
      ['Working capital / assets', '1.2', fmtNum(a.altman.parts.A, 3)], ['Retained earnings / assets', '1.4', fmtNum(a.altman.parts.B, 3)],
      ['EBIT / assets', '3.3', fmtNum(a.altman.parts.C, 3)], ['Market cap / liabilities', '0.6', fmtNum(a.altman.parts.D, 3)], ['Sales / assets', '1.0', fmtNum(a.altman.parts.E, 3)],
    ]));
    o.push(`History: ${a.altmanHistory.map((h) => `FY${h.period.slice(0, 4)} ${fmtNum(h.z, 2)}`).join(' · ')}`);
  }
  if (a.beneish) {
    o.push(`\n## Beneish M-score: ${fmtNum(a.beneish.m, 2)} (${a.beneish.zone}; > -1.78 likely manipulator) — \`score.beneish\``);
    const hint = { DSRI: '>1.46 suspicious', GMI: '>1.19 margins deteriorating', AQI: '>1.25 more capitalised costs', SGI: 'high growth = pressure', DEPI: '>1 slower depreciation', SGAI: 'rising overhead', LVGI: '>1 more leverage', TATA: '>0.03 accruals-driven earnings' };
    o.push(table(['Component', 'Value', 'Reading'], Object.entries(a.beneish.components).map(([k, v]) => [k, v == null ? 'n/a (neutral 1 used)' : fmtNum(v, 3), hint[k]])));
    o.push(`History: ${a.beneishHistory.map((h) => `FY${h.period.slice(0, 4)} ${fmtNum(h.m, 2)}`).join(' · ')}`);
  }
  const yrs = a.ratios.slice(-6);
  o.push('\n## Cash quality & working capital (cite as ratio.<FY>.<key>)');
  o.push(table(['key', 'Metric', ...yrs.map((r) => `FY${r.fy}`)],
    ['cfoToNetIncome', 'fcfToNetIncome', 'accrualRatio', 'receivableDays', 'inventoryDays', 'payableDays', 'capexToDepreciation', 'sbcToRevenue', 'effectiveTaxRate', 'shareCountChange']
      .filter((k) => yrs.some((r) => r[k] != null))
      .map((k) => [k, RATIO_DEFS[k].label, ...yrs.map((r) => fmtBy(RATIO_DEFS[k].fmt, r[k], d.currency))])));
  o.push(`\n## Red flags (${a.redFlags.flags.length})`);
  o.push(a.redFlags.flags.length ? a.redFlags.flags.map((f) => `- [${f.severity}] ${f.title} — ${f.detail}`).join('\n') : '- none triggered');
  o.push(`\n## Strengths (${a.redFlags.strengths.length})`);
  o.push(a.redFlags.strengths.length ? a.redFlags.strengths.map((s) => `- ${s.title} — ${s.detail}`).join('\n') : '- none detected');
  if ((d.holdingHistory || []).length > 1) {
    o.push('\n## Insider / promoter holding history');
    o.push(table(['Date', 'Insiders', 'Institutions'], d.holdingHistory.map((h) => [h.date, fmtPct(h.insidersPct, 2), fmtPct(h.institutionsPct, 2)])));
  }
  return o.join('\n');
};

COMMANDS.valuation = async (ctx) => {
  const { data: d, a } = ctx;
  const v = a.valuation;
  if (!v) return 'Not enough data for valuation.';
  const c = d.currency;
  const o = [`# ${d.symbol} valuation — price ${fmtPrice(d.quote.price, c)} (\`quote.price\`)`];
  o.push(`Default model: ${v.inputs.model === 'fcf' ? 'free cash flow' : 'earnings (net income)'} DCF, ${v.inputs.highGrowthYears}y high growth + ${v.inputs.fadeYears}y fade. Discount = risk-free ${fmtPct(d.assumptions.riskFree, 2)} + beta ${fmtNum(v.inputs.beta, 2)} × ERP ${fmtPct(d.assumptions.equityRiskPremium)}.`);
  o.push('\n## Scenarios');
  o.push(table(['Case', 'Growth', 'Discount', 'Terminal', 'Value / share', 'vs price', 'Ref'], ['bear', 'base', 'bull'].map((k) => {
    const s = v.scenarios[k];
    return [k, fmtPct(s.growth), fmtPct(s.discountRate), fmtPct(s.terminalGrowth), fmtPrice(v.fair[k], c), fmtPct(v.fair[k] / d.quote.price - 1), `\`val.${k}\``];
  })));
  o.push(refTable(ctx, [['Starting cash flow', 'val.inputs.baseCashFlow'], ['Net debt', 'val.inputs.netDebt'], ['Shares', 'val.inputs.shares'],
    ['Growth implied by price', 'val.impliedGrowth'], ['Terminal value share of EV', 'val.terminalShare'],
    ['Monte Carlo P10', 'val.mc.p10'], ['Monte Carlo P25', 'val.mc.p25'], ['Monte Carlo median', 'val.mc.p50'], ['Monte Carlo P75', 'val.mc.p75'], ['Monte Carlo P90', 'val.mc.p90'], ['P(value > price)', 'val.mc.probAbove'],
    ['Graham number', 'val.graham'], ['Justified P/B value', 'val.justifiedPB'], ['Justified P/B multiple', 'val.justifiedPBMultiple'], ['Value at mean P/E', 'val.atMeanPE'], ['Analyst mean target', 'val.analystTarget']]));
  if (v.multiples?.stats) {
    o.push(`\n## Multiples vs own history (month-end since ${v.multiples.from}; cite val.<multiple>.<stat>)`);
    o.push(table(['Multiple', 'Now', 'Mean', 'σ', 'Median', 'Min', 'Max', 'Percentile'], Object.entries(v.multiples.stats).map(([k, s]) => [
      k, fmtNum(s.current, 1), fmtNum(s.mean, 1), fmtNum(s.sd, 1), fmtNum(s.median, 1), fmtNum(s.min, 1), fmtNum(s.max, 1), fmtPct(s.percentile, 0),
    ])));
  }
  const sens = sensitivity(v.inputs);
  o.push('\n## Sensitivity: discount rate (rows) × terminal growth (cols), base case');
  o.push(table(['r \\ tg', ...sens.tgs.map((x) => fmtPct(x))], sens.rates.map((r, i) => [fmtPct(r), ...sens.grid[i].map((x) => fmtPrice(x, c))])));
  o.push('\nTest your own assumptions: `dcf <SYM> --growth 0.06 --discount 0.11 --terminal 0.03 [--model earnings] [--base N]`');
  return o.join('\n');
};

COMMANDS.dcf = async (ctx, { flags }) => {
  const { data: d, a } = ctx;
  if (!a.valuation) return 'Not enough data for valuation.';
  const num = (x) => (x === undefined || x === true ? undefined : Number(x));
  const inp = dcfInputs(d, a, {
    g: num(flags.growth), r: num(flags.discount), tg: num(flags.terminal), model: flags.model, base: num(flags.base), years: num(flags.years), fade: num(flags.fade),
  });
  const out = dcf(inp);
  if (!out) return 'Invalid inputs: discount rate must exceed terminal growth, and shares/base cash flow must be set.';
  const prefix = dcfRefPrefix(inp);
  const c = d.currency;
  const price = d.quote.price;
  const rev = reverseDcf(inp);
  const o = [`# ${d.symbol} custom DCF — cite results as ${prefix}.<field>`];
  o.push(table(['Input', 'Value'], [
    ['Model', inp.model === 'fcf' ? 'free cash flow' : 'earnings'], ['Starting cash flow', fmtMoney(inp.baseCashFlow, c)], ['Growth, years 1-' + inp.highGrowthYears, fmtPct(inp.growth)],
    ['Fade years', inp.fadeYears], ['Terminal growth', fmtPct(inp.terminalGrowth)], ['Discount rate', fmtPct(inp.discountRate)], ['Net debt', fmtMoney(inp.netDebt, c)], ['Shares', fmtNum(inp.shares / 1e6, 1) + 'M'],
  ]));
  o.push('\n## Result');
  o.push(table(['Metric', 'Value', 'Ref'], [
    ['Value per share', fmtPrice(out.perShare, c), `\`${prefix}.perShare\``],
    ['vs price ' + fmtPrice(price, c), fmtPct(out.perShare / price - 1), `\`${prefix}.upside\``],
    ['Enterprise value', fmtMoney(out.enterpriseValue, c), `\`${prefix}.enterpriseValue\``],
    ['Equity value', fmtMoney(out.equityValue, c), `\`${prefix}.equityValue\``],
    ['Terminal value share', fmtPct(out.terminalShare), `\`${prefix}.terminalShare\``],
    ['Growth the price implies (at this r / tg)', rev ? fmtPct(rev.impliedGrowth) : '—', `\`${prefix}.impliedGrowth\``],
  ]));
  o.push('\n## Projection');
  o.push(table(['Year', 'Growth', 'Cash flow', 'Present value'], out.flows.map((f) => [f.year, fmtPct(f.growth), fmtMoney(f.cashFlow, c), fmtMoney(f.pv, c)])));
  const sens = sensitivity(inp);
  o.push('\n## Sensitivity: growth (rows) × discount rate (cols)');
  o.push(table(['g \\ r', ...sens.rates.map((x) => fmtPct(x))], sens.growthRows.map((g, i) => [fmtPct(g), ...sens.grid2[i].map((x) => fmtPrice(x, c))])));
  const mc = monteCarlo(inp, { runs: 4000 });
  if (mc) o.push(`\nMonte Carlo (${mc.runs} runs): P10 ${fmtPrice(mc.p10, c)} · median ${fmtPrice(mc.p50, c)} · P90 ${fmtPrice(mc.p90, c)} · P(value > price) ${fmtPct(mc.probAbovePrice, 0)} (not citable — describe qualitatively or cite val.mc.* for the default model)`);
  return o.join('\n');
};

COMMANDS.risk = async (ctx) => {
  const { data: d, a } = ctx;
  const r = a.risk;
  if (!r) return 'Not enough price history.';
  const o = [`# ${d.symbol} risk & returns vs ${d.benchmark?.name || 'benchmark'}`];
  o.push(refTable(ctx, [
    ['Beta (3y daily)', 'risk.beta'], ['Correlation', 'risk.correlation'], ['Volatility 1y', 'risk.vol1y'], ['Volatility 3y', 'risk.vol3y'],
    ['1-day VaR 95%', 'risk.var95'], ['1-day CVaR 95%', 'risk.cvar95'], ['Max drawdown', 'risk.maxDrawdown'], ['Max drawdown 3y', 'risk.maxDrawdown3y'],
    ['Current drawdown', 'risk.currentDrawdown'], ['Sharpe 3y', 'risk.sharpe3y'], ['Sortino 3y', 'risk.sortino3y'], ['Up capture', 'risk.upCapture'], ['Down capture', 'risk.downCapture'],
  ]));
  if (r.maxDrawdown?.peak) o.push(`Max drawdown ran ${r.maxDrawdown.peak} → ${r.maxDrawdown.trough}.`);
  o.push('\n## Trailing returns (cite risk.ret.<P> / risk.bench.<P>)');
  o.push(table(['Period', 'Stock', 'Benchmark', 'Difference'], r.trailing.map((t) => [t.label + (t.annualized ? ' (ann.)' : ''), fmtPct(t.stock), fmtPct(t.benchmark), t.stock != null && t.benchmark != null ? fmtPct(t.stock - t.benchmark) : '—'])));
  o.push('\n## Calendar years');
  o.push(table(['Year', 'Stock', 'Benchmark'], r.yearly.map((y) => [y.year, fmtPct(y.stock), fmtPct(y.benchmark)])));
  o.push('\n## Technicals (cite risk.tech.<key>)');
  o.push(refTable(ctx, ['sma50', 'sma200', 'rsi14', 'high52', 'low52', 'fromHigh', 'fromLow', 'avgVolume50'].map((k) => [k, `risk.tech.${k}`])));
  return o.join('\n');
};

COMMANDS.peers = async (ctx, { flags }) => {
  const { data: d } = ctx;
  if (flags.peers && flags.peers !== true) {
    const list = String(flags.peers).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    d.peers = await fetchPeerRows(clients().yahoo, list, soft);
    writeJson(ctx.cacheFile, d);
  }
  if (!d.peers?.length) return 'No peers. Choose some: `peers <SYM> --peers A,B,C`.';
  const q = d.quote;
  const metrics = [
    ['trailingPE', 'P/E', 'quote.trailingPE', 'num'], ['forwardPE', 'Fwd P/E', 'quote.forwardPE', 'num'], ['evToEbitda', 'EV/EBITDA', 'quote.evToEbitda', 'num'],
    ['priceToBook', 'P/B', 'quote.priceToBook', 'num'], ['operatingMargin', 'Op margin', 'quote.ttm.operatingMargin', 'pct'], ['netMargin', 'Net margin', 'quote.ttm.netMargin', 'pct'],
    ['roe', 'ROE', 'quote.ttm.roe', 'pct'], ['revenueGrowth', 'Rev growth (qtr YoY)', 'quote.ttm.revenueGrowth', 'pct'], ['return1y', '1Y return', 'risk.ret.1Y', 'pct'],
  ];
  const f = (fmt, v) => (fmt === 'pct' ? fmtPct(v) : fmtNum(v, 1));
  const subject = { symbol: d.symbol, name: d.profile.name, marketCap: q.marketCap, currency: d.currency };
  for (const [k, , ref] of metrics) { const r = resolveRef(ref, ctx); subject[k] = r.ok ? r.value : null; }
  const rows = [subject, ...d.peers];
  const o = [`# ${d.symbol} vs peers (TTM, Yahoo Finance)`];
  o.push(`Cite peers as peer[SYMBOL].<field> (fields: ${metrics.map((m) => m[0]).filter((k) => k !== 'return1y').join(', ')}, marketCap, return1y); cite ${d.symbol} with the refs in the last row.`);
  o.push(table(['Symbol', 'Name', 'Industry', 'Mkt cap', ...metrics.map((m) => m[1])], rows.map((r) => [
    r.symbol === d.symbol ? `**${r.symbol}**` : r.symbol, r.name, r.industry || d.profile.industry || '', fmtMoney(r.marketCap, r.currency), ...metrics.map(([k, , , fmt]) => f(fmt, r[k])),
  ])));
  o.push(table(['Subject refs', ...metrics.map((m) => m[1])], [['', ...metrics.map((m) => `\`${m[2]}\``)]]));
  const ranks = metrics.map(([k, label]) => {
    const vals = rows.map((r) => r[k]).filter(Number.isFinite);
    const mine = subject[k];
    if (!Number.isFinite(mine) || vals.length < 2) return null;
    const lowerBetter = ['trailingPE', 'forwardPE', 'evToEbitda', 'priceToBook'].includes(k);
    const beaten = vals.filter((v) => (lowerBetter ? v > mine : v < mine)).length;
    return `${label}: beats ${beaten}/${vals.length - 1}`;
  }).filter(Boolean);
  o.push(`\nRank (${d.symbol} vs group; lower multiples count as better): ${ranks.join(' · ')}`);
  const sectors = new Set(d.peers.map((p) => p.sector).filter(Boolean));
  if (sectors.size > 1 || (d.profile.sector && !sectors.has(d.profile.sector))) o.push(`\n⚠ Peer set spans sectors (${[...sectors].join(', ')}). Consider \`--peers\` with true competitors.`);
  return o.join('\n');
};

COMMANDS.ownership = async (ctx) => {
  const { data: d } = ctx;
  const h = d.holders || {};
  const e = d.estimates || {};
  const c = d.currency;
  const o = [`# ${d.symbol} ownership, estimates & analyst activity`];
  o.push(refTable(ctx, [[d.market === 'IN' ? 'Promoters & insiders' : 'Insiders', 'holders.insidersPct'], ['Institutions', 'holders.institutionsPct'], ['Institutional holders', 'holders.institutionsCount']]));
  if (h.topInstitutions?.length) {
    o.push('\n## Top institutions');
    o.push(table(['Holder', 'Stake', 'Value', 'Change', 'As of'], h.topInstitutions.map((i) => [i.name, fmtPct(i.pct, 2), fmtMoney(i.value, c), fmtPct(i.change), i.date])));
  }
  if (h.insiderTransactions?.length) {
    o.push('\n## Insider transactions');
    o.push(table(['Date', 'Insider', 'Relation', 'Transaction', 'Shares', 'Value'], h.insiderTransactions.slice(0, 15).map((t) => [t.date, t.name, t.relation, t.text || '—', fmtNum(t.shares, 0), fmtMoney(t.value, c)])));
  }
  if (e.trend?.length) {
    o.push('\n## Consensus estimates (cite est.<period>.<field>)');
    o.push(table(['Period', 'End', 'EPS est', 'EPS growth', 'Revenue est', 'Revenue growth', 'Analysts'], e.trend.filter((t) => ['0q', '+1q', '0y', '+1y'].includes(t.period)).map((t) => [
      t.period, t.endDate, fmtNum(t.epsAvg, 2), fmtPct(t.growth), fmtMoney(t.revenueAvg, c), fmtPct(t.revenueGrowth), t.analysts ?? '—',
    ])));
  }
  if (e.earningsHistory?.length) {
    o.push('\n## Earnings surprises');
    o.push(table(['Quarter', 'Actual EPS', 'Estimate', 'Surprise'], e.earningsHistory.map((x) => [x.quarter, fmtNum(x.actual, 2), fmtNum(x.estimate, 2), fmtPct(x.surprisePct)])));
  }
  if (e.recommendations) {
    const r = e.recommendations;
    o.push(`\nRatings: ${r.strongBuy} strong buy · ${r.buy} buy · ${r.hold} hold · ${r.sell} sell · ${r.strongSell} strong sell`);
  }
  if (e.rating?.length) {
    o.push('\n## Recent rating changes');
    o.push(table(['Date', 'Firm', 'Action', 'From', 'To'], e.rating.map((r) => [r.date, r.firm, r.action, r.from || '—', r.to])));
  }
  return o.join('\n');
};

COMMANDS.news = async (ctx) => {
  const { data: d } = ctx;
  if (!d.news?.length) return 'No recent headlines from Yahoo. Use web search for news.';
  return [`# ${d.symbol} recent headlines`, ...d.news.map((n) => `- ${n.time ? n.time.slice(0, 10) : '?'} · ${n.title} — ${n.publisher} · ${n.link}`)].join('\n');
};

COMMANDS.filing = async (ctx, { flags }) => {
  const back = Number(flags.back) || 0;
  const { rep, reports, sections } = await filingSections(ctx, back);
  const refBase = (sec) => `filing.${sec}${back ? `@${back}` : ''}`;
  const head = [`# ${ctx.data.symbol} ${rep.form} filed ${rep.filed} (period ${rep.period}) — ${rep.url}`];
  if (flags.find && flags.find !== true) {
    const term = String(flags.find);
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const max = Number(flags.max) || 12;
    const hits = [];
    for (const [key, text] of Object.entries(sections)) {
      if (flags.section && flags.section !== key) continue;
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      lines.forEach((l, i) => {
        if (hits.length < max && re.test(l)) hits.push({ key, text: [lines[i - 1], l, lines[i + 1]].filter(Boolean).join(' ').slice(0, 1000) });
      });
    }
    head.push(`${hits.length} passage(s) mentioning "${term}". Quote verbatim and cite as ["quote"](#ref=${refBase('<section>')}).`);
    for (const h of hits) head.push(`\n[${refBase(h.key)}] ${h.text}`);
    return head.join('\n');
  }
  if (flags.section && flags.section !== true) {
    const key = String(flags.section);
    if (!(key in TENK_SECTIONS)) throw new Error(`--section must be one of ${Object.keys(TENK_SECTIONS).join(', ')}`);
    const text = sections[key] || '';
    const offset = Number(flags.offset) || 0;
    const limit = Number(flags.limit) || 12000;
    const chunk = text.slice(offset, offset + limit);
    head.push(`Section ${TENK_SECTIONS[key].title}: chars ${offset}–${offset + chunk.length} of ${text.length}${offset + limit < text.length ? ` (next: --offset ${offset + limit})` : ''}. Cite quotes as ["quote"](#ref=${refBase(key)}).`);
    head.push('', chunk);
    return head.join('\n');
  }
  head.push(table(['Section', 'Key', 'Characters'], Object.entries(TENK_SECTIONS).map(([k, s]) => [s.title, k, sections[k]?.length || 0])));
  head.push('\nAnnual reports available (use --back N for older ones):');
  head.push(reports.slice(0, 6).map((r, i) => `- ${i}: ${r.form} filed ${r.filed} (period ${r.period})`).join('\n'));
  head.push('\nRead: `filing <SYM> --section risk [--offset N --limit N]` · Search: `filing <SYM> --find "receivable"`');
  return head.join('\n');
};

function thesisTable(ctx) {
  const t = ctx.a.thesis;
  return table(['KPI', 'Rule', 'Actual', 'Status'], t.results.map((r) => [
    r.name || r.label, `${r.metric} ${r.op} ${r.value}${r.years > 1 ? ` (each of last ${r.years}y)` : ''}`,
    r.actual == null ? '—' : fmtBy(r.fmt, r.actual, ctx.data.currency) + (r.history && r.years > 1 ? ` [${r.history.map((h) => fmtBy(r.fmt, h, ctx.data.currency)).join(', ')}]` : ''), r.status,
  ]));
}

COMMANDS.thesis = async (ctx) => {
  const { data: d, a, thesis } = ctx;
  if (!thesis) {
    return [`No thesis for ${d.symbol}. Create theses/${fileKey(d.symbol)}.yml (see theses/AAPL.yml).`,
      `Metric keys: ${Object.keys(THESIS_METRICS).join(', ')}`].join('\n');
  }
  return [`# ${d.symbol} thesis — ${a.thesis.status.toUpperCase()}`, thesis.thesis || '', thesisTable(ctx)].join('\n\n');
};

COMMANDS.ref = async (ctx, { pos }) => {
  const ref = pos[2];
  if (!ref) throw new Error('usage: ref <SYM> <ref>');
  const r = resolveRef(ref, ctx);
  if (!r.ok) return `✗ ${ref}: ${r.error}`;
  if (r.filing) {
    const { rep, sections } = await filingSections(ctx, r.filing.back);
    return `${ref}: ${rep.form} filed ${rep.filed}, section ${r.filing.section} (${sections[r.filing.section]?.length || 0} chars) — ${rep.url}`;
  }
  return [`${ref} = ${formatValue(r.value, r.fmt, ctx.data.currency)} (raw ${r.value})`, `  ${r.label}`, r.source ? `  source: ${r.source.text}${r.source.url ? ` — ${r.source.url}` : ''}` : ''].filter(Boolean).join('\n');
};

// ---------------------------------------------------------------- commands without a single symbol

async function cmdSearch(query) {
  const { quotes } = await clients().yahoo.search(query, { quotes: 12 });
  if (!quotes.length) return `No matches for "${query}". Indian stocks use .NS (NSE) or .BO (BSE).`;
  return table(['Symbol', 'Name', 'Exchange', 'Type'], quotes.map((q) => [q.symbol, q.name, q.exchange, q.type]));
}

async function cmdCompare(symbols, flags) {
  const list = symbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const ctxs = [];
  for (const s of list) ctxs.push(await loadCached(s, { fresh: flags.fresh === true }));
  const rows = [
    ['Price', 'quote.price'], ['Market cap', 'quote.marketCap'], ['P/E (ttm)', 'quote.trailingPE'], ['EV/EBITDA', 'quote.evToEbitda'], ['P/B', 'quote.priceToBook'],
    ['Revenue growth', 'ratio.latest.revenueGrowth'], ['Revenue CAGR 3y', 'growth.revenue.3y'], ['EPS CAGR 3y', 'growth.eps.3y'],
    ['Gross margin', 'ratio.latest.grossMargin'], ['Operating margin', 'ratio.latest.operatingMargin'], ['Net margin', 'ratio.latest.netMargin'],
    ['ROE', 'ratio.latest.roe'], ['ROIC', 'ratio.latest.roic'], ['FCF margin', 'ratio.latest.fcfMargin'], ['OCF / net income', 'ratio.latest.cfoToNetIncome'],
    ['Debt / equity', 'ratio.latest.debtToEquity'], ['Net debt / EBITDA', 'ratio.latest.netDebtToEbitda'], ['Piotroski', 'score.piotroski'], ['Altman Z', 'score.altman'],
    ['Red flags', 'flags.count'], ['Base DCF upside', 'val.upside'], ['Implied growth', 'val.impliedGrowth'], ['P/E percentile (own history)', 'val.pe.percentile'],
    ['Beta', 'risk.beta'], ['Return 1Y', 'risk.ret.1Y'], ['Return 3Y (ann.)', 'risk.ret.3Y'],
  ];
  return [
    `# Comparison: ${list.join(' vs ')}`,
    'Cite as <SYMBOL>:<ref>, e.g. ' + `[25.1%](#ref=${list[0]}:ratio.latest.operatingMargin). Latest fiscal year per company (fiscal year-ends differ).`,
    table(['Metric', 'Ref', ...list], rows.map(([label, ref]) => [label, `\`${ref}\``, ...ctxs.map((c) => val(c, ref))])),
  ].join('\n');
}

async function cmdVerify(file, flags) {
  const md = readText(file);
  const symbol = (flags.symbol && flags.symbol !== true ? String(flags.symbol) : md.match(/^symbol:\s*["']?([^"'\n]+)/m)?.[1] || '').trim().toUpperCase();
  if (!symbol) throw new Error('Report needs `symbol:` in its frontmatter (or pass --symbol).');
  const cites = extractCitations(md);
  const rows = [];
  let bad = 0;
  for (const c of cites) {
    const { symbol: other, ref } = splitRef(c.ref);
    let status;
    let data = '';
    try {
      const ctx = await loadCached(other || symbol);
      const r = resolveRef(ref, ctx);
      if (!r.ok) { status = 'UNRESOLVED'; data = r.error; } else if (r.filing) {
        const { sections } = await filingSections(ctx, r.filing.back);
        const ok = quoteInText(c.text, sections[r.filing.section] || '');
        status = ok ? 'ok' : 'QUOTE NOT FOUND';
        data = `10-K ${r.filing.section}`;
      } else {
        const cmp = compareFigure(c.text, r.value);
        status = cmp.ok ? (cmp.note ? 'ok (sign in text)' : 'ok') : 'MISMATCH';
        data = formatValue(r.value, r.fmt, ctx.data.currency);
      }
    } catch (e) {
      status = 'ERROR';
      data = e.message;
    }
    if (!status.startsWith('ok')) bad++;
    rows.push([status, c.text.slice(0, 60), `\`${c.ref}\``, data]);
  }
  const uncited = uncitedFigures(md);
  const o = [`# Verification of ${path.basename(file)} (${symbol})`, `${cites.length} citations · ${cites.length - bad} verified · ${bad} problems`];
  if (rows.length) o.push(table(['Status', 'Text', 'Ref', 'Data'], rows));
  if (uncited.length) o.push(`\n⚠ ${uncited.length} figure(s) without a citation (cite them or remove): ${uncited.slice(0, 20).join(' · ')}`);
  if (!cites.length) o.push('No citations found. Cite figures as [figure](#ref=<ref>).');
  process.exitCode = bad ? 1 : 0;
  return o.join('\n');
}

function cmdTrail(symbol, flags) {
  const file = trailFile(symbol);
  if (flags.reset) {
    fs.rmSync(file, { force: true });
    return `Research trail for ${symbol} reset.`;
  }
  if (!fs.existsSync(file)) return `No research trail for ${symbol}.`;
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return [`# Research trail: ${symbol} (${lines.length} steps)`, ...lines.map((l, i) => `${i + 1}. ${l.ts.slice(11, 19)} ${l.command}`)].join('\n');
}

const HELP = `Research CLI — node cli/research.js <command> [args] [--flags]

Stock commands (<SYM> e.g. AAPL, TCS.NS, RELIANCE.BO):
  snapshot <SYM>                      Overview of everything; start here
  financials <SYM> [--period annual|quarterly] [--statement income|balance|cashflow|all] [--years N]
  ratios <SYM> [--group growth|profitability|returns|efficiency|balance|cash|capital|per] [--years N]
  forensics <SYM>                     Piotroski / Altman / Beneish detail, cash quality, red flags
  valuation <SYM>                     Default scenarios, reverse DCF, Monte Carlo, multiples vs history
  dcf <SYM> [--growth G] [--discount R] [--terminal TG] [--model fcf|earnings] [--base N] [--years N] [--fade N]
  risk <SYM>                          Beta, volatility, drawdowns, returns vs index, technicals
  peers <SYM> [--peers A,B,C]         Peer comparison (override the peer set)
  ownership <SYM>                     Holders, insider trades, consensus estimates, rating changes
  news <SYM>                          Recent headlines
  filing <SYM> [--section business|risk|mdna] [--offset N] [--limit N] [--find TERM] [--back N]   (US only)
  thesis <SYM>                        Evaluate theses/<SYM>.yml
  ref <SYM> <ref>                     Resolve a citation ref and show its source
  trail <SYM> [--reset]               Show / reset the research trail (every command is logged)

Other:
  search <query>                      Find tickers ("infosys", "hdfc bank")
  compare <A,B,C>                     Side-by-side key metrics
  verify <report.md> [--symbol SYM]   Check every [figure](#ref=...) citation against the data

Global: --fresh (refetch; data is cached 6h in .cache/)`;

async function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  const cmd = pos[0];
  if (!cmd || cmd === 'help' || flags.help) return HELP;
  if (cmd === 'search') return cmdSearch(pos.slice(1).join(' '));
  if (cmd === 'compare') { if (!pos[1]) throw new Error('usage: compare A,B,C'); return cmdCompare(pos[1], flags); }
  if (cmd === 'verify') { if (!pos[1]) throw new Error('usage: verify <report.md>'); return cmdVerify(pos[1], flags); }
  const symbol = pos[1]?.toUpperCase();
  if (cmd === 'trail') { if (!symbol) throw new Error('usage: trail <SYM>'); return cmdTrail(symbol, flags); }
  const fn = COMMANDS[cmd];
  if (!fn) throw new Error(`Unknown command "${cmd}". Run: node cli/research.js help`);
  if (!symbol) throw new Error(`usage: ${cmd} <SYM>`);
  recordTrail(symbol, process.argv.slice(2).join(' '));
  const ctx = await loadCached(symbol, { fresh: flags.fresh === true });
  return fn(ctx, { pos, flags });
}

main()
  .then((out) => { if (out) process.stdout.write(`${out}\n`); })
  .catch((e) => { err(`error: ${e.message}`); process.exitCode = 1; });

