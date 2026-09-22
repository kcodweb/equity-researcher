// Assembles one raw research dataset for a ticker from Yahoo (+ SEC for US listings).
// The same function runs in the daily pipeline and live in the browser.
import { FIELDS, FIELD_KEYS } from './fields.js';
import { raw } from './sources/yahoo.js';
import { annualFromFacts, recentFilings, latestAnnualReport } from './sources/sec.js';
import { marketOf, daysBetween, isNum } from './util.js';

export const DEFAULT_MARKETS = {
  US: { benchmark: '^GSPC', benchmarkName: 'S&P 500', riskFree: 0.042, equityRiskPremium: 0.045, terminalGrowth: 0.025, taxRate: 0.21 },
  IN: { benchmark: '^NSEI', benchmarkName: 'Nifty 50', riskFree: 0.064, equityRiskPremium: 0.07, terminalGrowth: 0.05, taxRate: 0.25 },
};

const SUMMARY_MODULES = [
  'price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'assetProfile',
  'majorHoldersBreakdown', 'institutionOwnership', 'insiderTransactions', 'earningsHistory',
  'earningsTrend', 'recommendationTrend', 'calendarEvents', 'upgradeDowngradeHistory',
];
const PEER_MODULES = ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'assetProfile'];

const YAHOO_TYPES = [...new Set(FIELD_KEYS.flatMap((k) => FIELDS[k].yahoo))];

export async function researchTicker(symbol, { yahoo, sec = null, markets = DEFAULT_MARKETS, peers: peerOverride = null, log = () => {} }) {
  symbol = symbol.trim().toUpperCase();
  const warnings = [];
  const soft = async (label, fn, fallback = null) => {
    try { return await fn(); } catch (e) { warnings.push(`${label}: ${e.message}`); log(`  ! ${label}: ${e.message}`); return fallback; }
  };

  const chart = await yahoo.chart(symbol, '10y', '1d');
  const currency = chart.meta.currency || 'USD';
  const market = marketOf(symbol, currency);
  const assumptions = { ...DEFAULT_MARKETS[market], ...(markets[market] || {}) };

  const [summary, annualY, quarterlyY, bench, search] = await Promise.all([
    soft('summary', () => yahoo.quoteSummary(symbol, SUMMARY_MODULES), {}),
    soft('annual financials', () => fetchTimeseries(yahoo, symbol, 'annual'), {}),
    soft('quarterly financials', () => fetchTimeseries(yahoo, symbol, 'quarterly'), {}),
    soft('benchmark', () => yahoo.chart(assumptions.benchmark, '10y', '1d')),
    soft('news', () => yahoo.search(symbol, { quotes: 0, news: 12 }), { news: [] }),
  ]);

  let annual = periodsFromYahoo(annualY);
  const quarterly = periodsFromYahoo(quarterlyY);

  // Some companies (e.g. Infosys) report statements in a different currency from
  // their share price. Convert statements into the trading currency.
  const financialCurrency = firstCurrency(annualY) || firstCurrency(quarterlyY) || currency;
  let fx = null;
  if (financialCurrency !== currency) {
    const fxChart = await soft('FX rate', () => yahoo.chart(`${financialCurrency}${currency}=X`, '5d', '1d'));
    fx = fxChart?.rows?.at(-1)?.[1] ?? null;
    if (isNum(fx)) {
      convertPeriods(annual, fx);
      convertPeriods(quarterly, fx);
      warnings.push(`Statements reported in ${financialCurrency}; converted to ${currency} at ${fx.toFixed(4)}.`);
    } else {
      warnings.push(`Statements are in ${financialCurrency} but no FX rate was available — ratios mixing price and fundamentals are unreliable.`);
    }
  }
  let sources = null;
  let filings = [];
  let cik = null;
  let annualReport = null;
  let dataSource = 'Yahoo Finance';

  if (market === 'US' && sec) {
    cik = await soft('SEC lookup', () => sec.cik(symbol));
    if (cik) {
      const [facts, subs] = await Promise.all([
        soft('SEC company facts', () => sec.companyFacts(cik)),
        soft('SEC filings', () => sec.submissions(cik)),
      ]);
      const fromSec = facts ? annualFromFacts(facts) : null;
      if (fromSec && fromSec.periods.length >= 2) {
        annual = mergeAnnual(fromSec.periods, annual);
        sources = fromSec.sources;
        dataSource = 'SEC EDGAR (XBRL) + Yahoo Finance';
      }
      if (subs) {
        filings = recentFilings(subs);
        annualReport = latestAnnualReport(subs);
      }
      if (market === 'US') {
        const tnx = await soft('10Y yield', () => yahoo.chart('^TNX', '5d', '1d'));
        const last = tnx?.rows?.at(-1)?.[1];
        if (isNum(last) && last > 0.5 && last < 15) assumptions.riskFree = last / 100;
      }
    }
  }

  const splitHistory = (await soft('split history', () => yahoo.chart(symbol, 'max', '3mo')))?.splits || chart.splits;
  if (sources) adjustForSplits(annual, sources, splitHistory);
  const sharesNow = raw(summary?.defaultKeyStatistics?.sharesOutstanding);
  adjustUnrestatedYahoo(annual, sources, splitHistory, sharesNow);
  adjustUnrestatedYahoo(quarterly, null, splitHistory, sharesNow);
  annual.forEach(derive);
  quarterly.forEach(derive);

  const s = summary || {};
  const price = raw(s.price?.regularMarketPrice) ?? chart.meta.regularMarketPrice ?? chart.rows.at(-1)?.[1];
  const profile = {
    name: s.price?.longName || s.price?.shortName || chart.meta.longName || symbol,
    exchange: s.price?.exchangeName || chart.meta.fullExchangeName,
    quoteType: s.price?.quoteType || chart.meta.instrumentType,
    sector: s.assetProfile?.sector || null,
    industry: s.assetProfile?.industry || null,
    country: s.assetProfile?.country || null,
    city: s.assetProfile?.city || null,
    website: s.assetProfile?.website || null,
    employees: s.assetProfile?.fullTimeEmployees ?? null,
    summary: s.assetProfile?.longBusinessSummary || '',
    officers: (s.assetProfile?.companyOfficers || []).slice(0, 6).map((o) => ({ name: o.name, title: o.title, age: o.age ?? null })),
  };

  const quote = {
    price,
    previousClose: raw(s.price?.regularMarketPreviousClose) ?? chart.meta.chartPreviousClose,
    change: raw(s.price?.regularMarketChange),
    changePct: raw(s.price?.regularMarketChangePercent),
    marketCap: raw(s.price?.marketCap) ?? raw(s.summaryDetail?.marketCap),
    sharesOutstanding: raw(s.defaultKeyStatistics?.sharesOutstanding) ?? raw(s.defaultKeyStatistics?.impliedSharesOutstanding),
    enterpriseValue: raw(s.defaultKeyStatistics?.enterpriseValue),
    beta: raw(s.summaryDetail?.beta) ?? raw(s.defaultKeyStatistics?.beta),
    trailingPE: raw(s.summaryDetail?.trailingPE),
    forwardPE: raw(s.summaryDetail?.forwardPE) ?? raw(s.defaultKeyStatistics?.forwardPE),
    priceToBook: raw(s.defaultKeyStatistics?.priceToBook),
    priceToSales: raw(s.summaryDetail?.priceToSalesTrailing12Months),
    evToEbitda: raw(s.defaultKeyStatistics?.enterpriseToEbitda),
    evToRevenue: raw(s.defaultKeyStatistics?.enterpriseToRevenue),
    pegRatio: raw(s.defaultKeyStatistics?.pegRatio),
    trailingEps: raw(s.defaultKeyStatistics?.trailingEps),
    forwardEps: raw(s.defaultKeyStatistics?.forwardEps),
    bookValuePerShare: raw(s.defaultKeyStatistics?.bookValue),
    dividendYield: raw(s.summaryDetail?.dividendYield),
    payoutRatio: raw(s.summaryDetail?.payoutRatio),
    fiftyTwoWeekHigh: raw(s.summaryDetail?.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: raw(s.summaryDetail?.fiftyTwoWeekLow),
    targetMean: raw(s.financialData?.targetMeanPrice),
    targetHigh: raw(s.financialData?.targetHighPrice),
    targetLow: raw(s.financialData?.targetLowPrice),
    recommendation: s.financialData?.recommendationKey || null,
    analystCount: raw(s.financialData?.numberOfAnalystOpinions),
    ttm: {
      revenue: raw(s.financialData?.totalRevenue),
      ebitda: raw(s.financialData?.ebitda),
      fcf: raw(s.financialData?.freeCashflow),
      cfo: raw(s.financialData?.operatingCashflow),
      cash: raw(s.financialData?.totalCash),
      debt: raw(s.financialData?.totalDebt),
      grossMargin: raw(s.financialData?.grossMargins),
      operatingMargin: raw(s.financialData?.operatingMargins),
      netMargin: raw(s.financialData?.profitMargins),
      roe: raw(s.financialData?.returnOnEquity),
      roa: raw(s.financialData?.returnOnAssets),
      revenueGrowth: raw(s.financialData?.revenueGrowth),
      earningsGrowth: raw(s.financialData?.earningsGrowth),
    },
    nextEarnings: raw(s.calendarEvents?.earnings?.earningsDate?.[0]),
  };

  const holders = {
    insidersPct: raw(s.majorHoldersBreakdown?.insidersPercentHeld),
    institutionsPct: raw(s.majorHoldersBreakdown?.institutionsPercentHeld),
    institutionsCount: raw(s.majorHoldersBreakdown?.institutionsCount),
    topInstitutions: (s.institutionOwnership?.ownershipList || []).slice(0, 10).map((o) => ({
      name: o.organization, pct: raw(o.pctHeld), value: raw(o.value), change: raw(o.pctChange), date: o.reportDate?.fmt || null,
    })),
    insiderTransactions: (s.insiderTransactions?.transactions || []).slice(0, 20).map((t) => ({
      name: t.filerName, relation: t.filerRelation, text: t.transactionText, shares: raw(t.shares), value: raw(t.value), date: t.startDate?.fmt || null,
    })),
  };

  const estimates = {
    earningsHistory: (s.earningsHistory?.history || []).map((h) => ({
      quarter: h.quarter?.fmt || null, actual: raw(h.epsActual), estimate: raw(h.epsEstimate), surprisePct: raw(h.surprisePercent),
    })),
    trend: (s.earningsTrend?.trend || []).map((t) => ({
      period: t.period, endDate: t.endDate, growth: raw(t.growth),
      epsAvg: raw(t.earningsEstimate?.avg), revenueAvg: raw(t.revenueEstimate?.avg), revenueGrowth: raw(t.revenueEstimate?.growth),
      analysts: raw(t.earningsEstimate?.numberOfAnalysts),
    })),
    recommendations: s.recommendationTrend?.trend?.[0] || null,
    rating: (s.upgradeDowngradeHistory?.history || []).slice(0, 12).map((h) => ({
      date: h.epochGradeDate ? new Date(h.epochGradeDate * (h.epochGradeDate > 1e12 ? 1 : 1000)).toISOString().slice(0, 10) : null,
      firm: h.firm, from: h.fromGrade, to: h.toGrade, action: h.action,
    })),
  };

  // Indian tickers rarely match news by symbol; retry with the company name.
  let news = search?.news || [];
  if (!news.length && profile.name !== symbol) {
    const shortName = profile.name.replace(/\b(limited|ltd\.?|inc\.?|corporation|corp\.?|plc)\b/gi, '').trim();
    news = (await soft('news by name', () => yahoo.search(shortName, { quotes: 0, news: 12 }), { news: [] })).news;
  }

  // Peers: configured list, else Yahoo's "similar symbols".
  let peerSymbols = peerOverride;
  if (!peerSymbols || !peerSymbols.length) {
    peerSymbols = (await soft('peer suggestions', () => yahoo.recommendations(symbol), [])).filter((p) => p !== symbol).slice(0, 5);
  }
  const peers = (await Promise.all(peerSymbols.slice(0, 8).map((p) => soft(`peer ${p}`, () => peerRow(yahoo, p))))).filter(Boolean);

  return {
    version: 1,
    symbol,
    market,
    currency,
    generatedAt: new Date().toISOString(),
    dataSource,
    financialCurrency,
    fxRate: fx,
    cik,
    profile,
    quote,
    assumptions,
    prices: chart.rows,
    dividends: chart.dividends,
    splits: chart.splits,
    benchmark: bench ? { symbol: assumptions.benchmark, name: assumptions.benchmarkName, prices: bench.rows.map((r) => [r[0], r[2]]) } : null,
    annual,
    quarterly,
    sources,
    filings,
    annualReport,
    holders,
    estimates,
    peers,
    news: news.slice(0, 12),
    warnings,
  };
}

async function fetchTimeseries(yahoo, symbol, prefix) {
  const half = Math.ceil(YAHOO_TYPES.length / 2);
  const [a, b] = await Promise.all([
    yahoo.timeseries(symbol, prefix, YAHOO_TYPES.slice(0, half)),
    yahoo.timeseries(symbol, prefix, YAHOO_TYPES.slice(half)),
  ]);
  return { ...a, ...b };
}

function firstCurrency(series) {
  for (const pts of Object.values(series || {})) for (const p of pts) if (p.currency) return p.currency;
  return null;
}

function convertPeriods(periods, fx) {
  for (const p of periods) {
    for (const [k, def] of Object.entries(FIELDS)) {
      if (def.unit === 'shares' || !isNum(p[k])) continue;
      p[k] *= fx;
    }
  }
}

function periodsFromYahoo(series) {
  const byDate = {};
  for (const key of FIELD_KEYS) {
    const def = FIELDS[key];
    for (const type of def.yahoo) {
      for (const pt of series[type] || []) {
        const p = (byDate[pt.date] ||= { period: pt.date });
        if (p[key] == null) p[key] = pt.value * (def.yahooSign || 1);
      }
    }
  }
  return Object.values(byDate)
    .filter((p) => Object.keys(p).length > 4)
    .sort((x, y) => x.period.localeCompare(y.period));
}

// SEC is the primary annual source; Yahoo fills missing fields and newer years.
function mergeAnnual(secPeriods, yahooPeriods) {
  const out = secPeriods.map((p) => ({ ...p }));
  for (const y of yahooPeriods) {
    const match = out.find((p) => Math.abs(daysBetween(p.period, y.period)) <= 10);
    if (match) {
      for (const [k, v] of Object.entries(y)) if (k !== 'period' && match[k] == null) match[k] = v;
    } else if (y.period > out.at(-1).period) {
      out.push({ ...y });
    }
  }
  return out;
}

// SEC values are as-filed: per-share figures in filings made before a later
// split are restated here onto today's share basis (prices are split-adjusted).
function adjustForSplits(annual, sources, splits) {
  const parsed = splits.map(([date, r]) => {
    const [num, den] = r.split(':').map(Number);
    return { date, factor: num / den };
  }).filter((s) => s.factor > 0 && s.factor !== 1);
  if (!parsed.length) return;
  for (const p of annual) {
    for (const field of ['epsDiluted', 'sharesDiluted', 'sharesOutstanding']) {
      const src = sources[p.period]?.[field];
      if (!src || !isNum(p[field])) continue;
      const factor = parsed.filter((s) => s.date > src.filed).reduce((f, s) => f * s.factor, 1);
      if (factor === 1) continue;
      p[field] = field === 'epsDiluted' ? p[field] / factor : p[field] * factor;
      src.splitAdjusted = factor;
    }
  }
}

// Yahoo sometimes leaves older periods on the pre-split / pre-bonus share basis.
// Walking back from the newest period, a period is restated by a later split
// factor when that makes it continuous with the (already correct) next period.
// Continuity rather than today's share count, so mergers don't fool it.
function adjustUnrestatedYahoo(periods, sources, splits, sharesNow) {
  const parsed = splits.map(([date, r]) => {
    const [num, den] = r.split(':').map(Number);
    return { date, factor: num / den };
  }).filter((s) => s.factor > 0 && s.factor !== 1);
  if (!parsed.length) return;
  const dev = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? Math.abs(a / b - 1) : Infinity);
  for (let i = periods.length - 1; i >= 0; i--) {
    const p = periods[i];
    // Candidate factors: cumulative products of the splits after this period, newest first.
    const later = parsed.filter((s) => s.date > p.period).sort((a, b) => b.date.localeCompare(a.date));
    const cands = [];
    let acc = 1;
    for (const s of later) cands.push((acc *= s.factor));
    if (!cands.length) continue;
    const next = periods[i + 1];
    for (const [field, dir] of [['epsDiluted', -1], ['sharesDiluted', 1], ['sharesOutstanding', 1]]) {
      if (sources?.[p.period]?.[field] || !isNum(p[field])) continue;
      const ref = next?.[field] ?? (field === 'epsDiluted' ? null : sharesNow);
      if (!isNum(ref)) continue;
      const apply = (c) => (dir < 0 ? p[field] / c : p[field] * c);
      const best = cands.map((c) => ({ c, d: dev(apply(c), ref) })).sort((a, b) => a.d - b.d)[0];
      // Must be a clear improvement and land within a plausible year-on-year band.
      if (best.d < 0.35 && best.d < dev(p[field], ref) / 2) p[field] = apply(best.c);
    }
  }
}

function derive(p) {
  const n = (k) => (isNum(p[k]) ? p[k] : null);
  if (p.grossProfit == null && n('revenue') != null && n('costOfRevenue') != null) p.grossProfit = p.revenue - p.costOfRevenue;
  if (p.costOfRevenue == null && n('revenue') != null && n('grossProfit') != null) p.costOfRevenue = p.revenue - p.grossProfit;
  if (p.ebitda == null && n('operatingIncome') != null && n('depreciation') != null) p.ebitda = p.operatingIncome + p.depreciation;
  if (p.totalDebt == null && (n('shortTermDebt') != null || n('longTermDebt') != null)) p.totalDebt = (p.shortTermDebt || 0) + (p.longTermDebt || 0);
  if (p.fcf == null && n('cfo') != null) p.fcf = p.cfo - (p.capex || 0);
  p.fy = Number(p.period.slice(0, 4));
}

async function peerRow(yahoo, symbol) {
  const s = await yahoo.quoteSummary(symbol, PEER_MODULES);
  return {
    symbol,
    name: s.price?.longName || s.price?.shortName || symbol,
    currency: s.price?.currency,
    industry: s.assetProfile?.industry || null,
    price: raw(s.price?.regularMarketPrice),
    marketCap: raw(s.price?.marketCap),
    trailingPE: raw(s.summaryDetail?.trailingPE),
    forwardPE: raw(s.summaryDetail?.forwardPE),
    priceToBook: raw(s.defaultKeyStatistics?.priceToBook),
    priceToSales: raw(s.summaryDetail?.priceToSalesTrailing12Months),
    evToEbitda: raw(s.defaultKeyStatistics?.enterpriseToEbitda),
    dividendYield: raw(s.summaryDetail?.dividendYield),
    grossMargin: raw(s.financialData?.grossMargins),
    operatingMargin: raw(s.financialData?.operatingMargins),
    netMargin: raw(s.financialData?.profitMargins),
    roe: raw(s.financialData?.returnOnEquity),
    revenueGrowth: raw(s.financialData?.revenueGrowth),
    earningsGrowth: raw(s.financialData?.earningsGrowth),
    debtToEquity: raw(s.financialData?.debtToEquity),
    return1y: raw(s.defaultKeyStatistics?.['52WeekChange']),
    beta: raw(s.summaryDetail?.beta),
  };
}
