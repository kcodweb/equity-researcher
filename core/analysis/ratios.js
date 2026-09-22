import { div, avg2, growth, cagr, isNum } from '../util.js';

// Display metadata for every ratio: group, label, format (pct | x | days | num | money), and
// whether higher is better (used for colouring and peer percentiles).
export const RATIO_DEFS = {
  revenueGrowth: { group: 'Growth', label: 'Revenue growth', fmt: 'pct', better: 'up' },
  operatingIncomeGrowth: { group: 'Growth', label: 'Operating income growth', fmt: 'pct', better: 'up' },
  netIncomeGrowth: { group: 'Growth', label: 'Net income growth', fmt: 'pct', better: 'up' },
  epsGrowth: { group: 'Growth', label: 'EPS growth', fmt: 'pct', better: 'up' },
  fcfGrowth: { group: 'Growth', label: 'FCF growth', fmt: 'pct', better: 'up' },
  bookValueGrowth: { group: 'Growth', label: 'Book value / share growth', fmt: 'pct', better: 'up' },

  grossMargin: { group: 'Profitability', label: 'Gross margin', fmt: 'pct', better: 'up' },
  ebitdaMargin: { group: 'Profitability', label: 'EBITDA margin', fmt: 'pct', better: 'up' },
  operatingMargin: { group: 'Profitability', label: 'Operating margin', fmt: 'pct', better: 'up' },
  netMargin: { group: 'Profitability', label: 'Net margin', fmt: 'pct', better: 'up' },
  fcfMargin: { group: 'Profitability', label: 'FCF margin', fmt: 'pct', better: 'up' },
  rndToRevenue: { group: 'Profitability', label: 'R&D / revenue', fmt: 'pct' },
  effectiveTaxRate: { group: 'Profitability', label: 'Effective tax rate', fmt: 'pct' },

  roe: { group: 'Returns', label: 'Return on equity', fmt: 'pct', better: 'up' },
  roa: { group: 'Returns', label: 'Return on assets', fmt: 'pct', better: 'up' },
  roic: { group: 'Returns', label: 'Return on invested capital', fmt: 'pct', better: 'up' },
  roce: { group: 'Returns', label: 'Return on capital employed', fmt: 'pct', better: 'up' },

  assetTurnover: { group: 'Efficiency', label: 'Asset turnover', fmt: 'x', better: 'up' },
  receivableDays: { group: 'Efficiency', label: 'Receivable days (DSO)', fmt: 'days', better: 'down' },
  inventoryDays: { group: 'Efficiency', label: 'Inventory days (DIO)', fmt: 'days', better: 'down' },
  payableDays: { group: 'Efficiency', label: 'Payable days (DPO)', fmt: 'days' },
  cashConversionCycle: { group: 'Efficiency', label: 'Cash conversion cycle', fmt: 'days', better: 'down' },

  debtToEquity: { group: 'Balance sheet', label: 'Debt / equity', fmt: 'x', better: 'down' },
  netDebtToEbitda: { group: 'Balance sheet', label: 'Net debt / EBITDA', fmt: 'x', better: 'down' },
  interestCoverage: { group: 'Balance sheet', label: 'Interest coverage', fmt: 'x', better: 'up' },
  currentRatio: { group: 'Balance sheet', label: 'Current ratio', fmt: 'x', better: 'up' },
  quickRatio: { group: 'Balance sheet', label: 'Quick ratio', fmt: 'x', better: 'up' },
  equityMultiplier: { group: 'Balance sheet', label: 'Equity multiplier', fmt: 'x' },
  intangiblesToAssets: { group: 'Balance sheet', label: 'Goodwill + intangibles / assets', fmt: 'pct', better: 'down' },

  cfoToNetIncome: { group: 'Cash quality', label: 'Operating cash flow / net income', fmt: 'x', better: 'up' },
  fcfToNetIncome: { group: 'Cash quality', label: 'FCF / net income', fmt: 'x', better: 'up' },
  accrualRatio: { group: 'Cash quality', label: 'Accrual ratio (Sloan)', fmt: 'pct', better: 'down' },
  capexToRevenue: { group: 'Cash quality', label: 'Capex / revenue', fmt: 'pct' },
  capexToDepreciation: { group: 'Cash quality', label: 'Capex / depreciation', fmt: 'x' },
  sbcToRevenue: { group: 'Cash quality', label: 'Stock comp / revenue', fmt: 'pct', better: 'down' },

  payoutRatio: { group: 'Capital allocation', label: 'Dividends / FCF', fmt: 'pct' },
  buybackToFcf: { group: 'Capital allocation', label: 'Buybacks / FCF', fmt: 'pct' },
  acquisitionsToFcf: { group: 'Capital allocation', label: 'Acquisitions / FCF', fmt: 'pct' },
  shareholderYieldOfFcf: { group: 'Capital allocation', label: 'Total returned / FCF', fmt: 'pct' },
  shareCountChange: { group: 'Capital allocation', label: 'Share count change', fmt: 'pct', better: 'down' },

  eps: { group: 'Per share', label: 'EPS (diluted)', fmt: 'num' },
  bookValuePerShare: { group: 'Per share', label: 'Book value / share', fmt: 'num' },
  fcfPerShare: { group: 'Per share', label: 'FCF / share', fmt: 'num' },
  revenuePerShare: { group: 'Per share', label: 'Revenue / share', fmt: 'num' },
};

export function isFinancialCompany(profile) {
  const s = `${profile?.sector || ''} ${profile?.industry || ''}`.toLowerCase();
  return /financial|bank|insurance|capital markets|credit services|asset management/.test(s);
}

export function computeRatios(annual, { taxRate = 0.25 } = {}) {
  return annual.map((p, i) => {
    const q = annual[i - 1] || {};
    const shares = p.sharesDiluted ?? p.sharesOutstanding;
    const prevShares = q.sharesDiluted ?? q.sharesOutstanding;
    const avgEquity = avg2(p.equity, q.equity);
    const avgAssets = avg2(p.totalAssets, q.totalAssets);
    const taxEff = div(p.incomeTax, p.pretaxIncome);
    const tax = isNum(taxEff) && taxEff > 0 && taxEff < 0.5 ? taxEff : taxRate;
    const nopat = isNum(p.operatingIncome) ? p.operatingIncome * (1 - tax) : null;
    const liquid = (p.cash || 0) + (p.shortTermInvestments || 0);
    const investedCapital = (e, d, c) => (isNum(e) ? e + (d || 0) - c : null);
    const icNow = investedCapital(p.equity, p.totalDebt, liquid);
    const icPrev = investedCapital(q.equity, q.totalDebt, (q.cash || 0) + (q.shortTermInvestments || 0));
    const eps = p.epsDiluted ?? div(p.netIncome, shares);
    const prevEps = q.epsDiluted ?? div(q.netIncome, prevShares);
    const bvps = div(p.equity, p.sharesOutstanding ?? shares);
    const prevBvps = div(q.equity, q.sharesOutstanding ?? prevShares);
    const returned = (p.dividendsPaid || 0) + (p.buybacks || 0);
    const dso = div(p.receivables, p.revenue) != null ? div(p.receivables, p.revenue) * 365 : null;
    const dio = div(p.inventory, p.costOfRevenue) != null ? div(p.inventory, p.costOfRevenue) * 365 : null;
    const dpo = div(p.accountsPayable, p.costOfRevenue) != null ? div(p.accountsPayable, p.costOfRevenue) * 365 : null;
    const netDebt = isNum(p.totalDebt) ? p.totalDebt - liquid : null;

    return {
      period: p.period,
      fy: p.fy,
      revenueGrowth: growth(p.revenue, q.revenue),
      operatingIncomeGrowth: growth(p.operatingIncome, q.operatingIncome),
      netIncomeGrowth: growth(p.netIncome, q.netIncome),
      epsGrowth: growth(eps, prevEps),
      fcfGrowth: growth(p.fcf, q.fcf),
      bookValueGrowth: growth(bvps, prevBvps),

      grossMargin: div(p.grossProfit, p.revenue),
      ebitdaMargin: div(p.ebitda, p.revenue),
      operatingMargin: div(p.operatingIncome, p.revenue),
      netMargin: div(p.netIncome, p.revenue),
      fcfMargin: div(p.fcf, p.revenue),
      rndToRevenue: div(p.rnd, p.revenue),
      effectiveTaxRate: taxEff,

      roe: div(p.netIncome, avgEquity),
      roa: div(p.netIncome, avgAssets),
      roic: icNow > 0 ? div(nopat, avg2(icNow, icPrev > 0 ? icPrev : null)) : null,
      roce: div(p.operatingIncome, isNum(p.totalAssets) && isNum(p.currentLiabilities) ? p.totalAssets - p.currentLiabilities : null),

      assetTurnover: div(p.revenue, avgAssets),
      receivableDays: dso,
      inventoryDays: dio,
      payableDays: dpo,
      cashConversionCycle: isNum(dso) && isNum(dpo) ? dso + (dio || 0) - dpo : null,

      debtToEquity: p.equity > 0 ? div(p.totalDebt, p.equity) : null,
      netDebtToEbitda: p.ebitda > 0 ? div(netDebt, p.ebitda) : null,
      interestCoverage: p.interestExpense > 0 ? div(p.operatingIncome, p.interestExpense) : null,
      currentRatio: div(p.currentAssets, p.currentLiabilities),
      quickRatio: isNum(p.currentAssets) ? div(p.currentAssets - (p.inventory || 0), p.currentLiabilities) : null,
      equityMultiplier: div(avgAssets, avgEquity),
      intangiblesToAssets: div((p.goodwill || 0) + (p.intangibles || 0), p.totalAssets),

      cfoToNetIncome: p.netIncome > 0 ? div(p.cfo, p.netIncome) : null,
      fcfToNetIncome: p.netIncome > 0 ? div(p.fcf, p.netIncome) : null,
      accrualRatio: isNum(p.netIncome) && isNum(p.cfo) ? div(p.netIncome - p.cfo, avgAssets) : null,
      capexToRevenue: div(p.capex, p.revenue),
      capexToDepreciation: div(p.capex, p.depreciation),
      sbcToRevenue: div(p.sbc, p.revenue),

      payoutRatio: p.fcf > 0 ? div(p.dividendsPaid, p.fcf) : null,
      buybackToFcf: p.fcf > 0 ? div(p.buybacks, p.fcf) : null,
      acquisitionsToFcf: p.fcf > 0 ? div(p.acquisitions, p.fcf) : null,
      shareholderYieldOfFcf: p.fcf > 0 && returned ? returned / p.fcf : null,
      shareCountChange: growth(shares, prevShares),

      eps,
      bookValuePerShare: bvps,
      fcfPerShare: div(p.fcf, shares),
      revenuePerShare: div(p.revenue, shares),
      nopat,
      netDebt,
    };
  });
}

// DuPont: ROE = net margin × asset turnover × equity multiplier.
export function dupont(ratios) {
  return ratios.map((r) => ({
    period: r.period,
    netMargin: r.netMargin,
    assetTurnover: r.assetTurnover,
    equityMultiplier: r.equityMultiplier,
    roe: r.roe,
  }));
}

export function growthSummary(annual, ratios) {
  const n = annual.length;
  const last = annual[n - 1] || {};
  const at = (k, yearsBack) => {
    const idx = n - 1 - yearsBack;
    return idx >= 0 ? annual[idx][k] : null;
  };
  const rAt = (k, yearsBack) => {
    const idx = n - 1 - yearsBack;
    return idx >= 0 ? ratios[idx][k] : null;
  };
  const out = {};
  for (const [key, getter] of [
    ['revenue', (y) => (y === 0 ? last.revenue : at('revenue', y))],
    ['netIncome', (y) => (y === 0 ? last.netIncome : at('netIncome', y))],
    ['eps', (y) => rAt('eps', y)],
    ['fcf', (y) => (y === 0 ? last.fcf : at('fcf', y))],
    ['bookValuePerShare', (y) => rAt('bookValuePerShare', y)],
    ['dividends', (y) => (y === 0 ? last.dividendsPaid : at('dividendsPaid', y))],
  ]) {
    out[key] = {};
    for (const y of [3, 5, 10]) out[key][`${y}y`] = n > y ? cagr(getter(0), getter(y), y) : null;
    // Short histories (e.g. 4 years from Yahoo) still get a full-span CAGR.
    if (n >= 2) out[key].full = cagr(getter(0), getter(n - 1), n - 1);
  }
  out.years = n;
  return out;
}
