// SEC EDGAR client: ticker -> CIK, XBRL company facts -> annual statements with
// a source filing for every number, recent filings, and 10-K text for the AI note.
import { FIELDS } from '../fields.js';
import { daysBetween } from '../util.js';

export function createSec({ dataBase = 'https://data.sec.gov', wwwBase = 'https://www.sec.gov', fetchImpl = fetch, userAgent = null } = {}) {
  const headers = userAgent ? { 'User-Agent': userAgent, 'Accept-Encoding': 'gzip, deflate' } : {};
  let tickerMap = null;

  async function get(url, type = 'json') {
    const res = await fetchImpl(url, { headers });
    if (!res.ok) throw new Error(`SEC ${res.status} for ${url.replace(/^https?:\/\/[^/]+/, '')}`);
    return type === 'json' ? res.json() : res.text();
  }

  return {
    async cik(ticker) {
      if (!tickerMap) {
        const j = await get(`${wwwBase}/files/company_tickers.json`);
        tickerMap = {};
        for (const v of Object.values(j)) tickerMap[v.ticker.toUpperCase()] = v.cik_str;
      }
      return tickerMap[ticker.toUpperCase().replace('.', '-')] ?? null;
    },
    companyFacts: (cik) => get(`${dataBase}/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`),
    submissions: (cik) => get(`${dataBase}/submissions/CIK${String(cik).padStart(10, '0')}.json`),
    document: (url) => get(url.replace('https://www.sec.gov', wwwBase), 'text'),
  };
}

export const filingUrl = (cik, accn) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, '')}/${accn}-index.htm`;

const ANNUAL_FORMS = new Set(['10-K', '10-K/A', '10-KT']);

// Builds { periods: [{ period, fy, ...fields }], sources: { period: { field: {accn, form, filed} } } }
export function annualFromFacts(facts, maxYears = 12) {
  const gaap = facts?.facts?.['us-gaap'];
  if (!gaap) return null;

  const unitsOf = (tag, unit) => gaap[tag]?.units?.[unit] || [];
  const isAnnualFlow = (f) => f.start && ANNUAL_FORMS.has(f.form) && Math.abs(daysBetween(f.start, f.end) - 365) <= 20;

  // Fiscal year-end dates come from annual income-statement durations.
  const yearEnds = new Set();
  for (const tag of ['NetIncomeLoss', 'Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'OperatingIncomeLoss', 'NetCashProvidedByUsedInOperatingActivities']) {
    for (const f of unitsOf(tag, 'USD')) if (isAnnualFlow(f)) yearEnds.add(f.end);
  }
  if (!yearEnds.size) return null;
  const ends = [...yearEnds].sort().slice(-maxYears);
  const matchEnd = (d) => ends.find((e) => Math.abs(daysBetween(e, d)) <= 3);

  const periods = Object.fromEntries(ends.map((e) => [e, { period: e }]));
  const sources = Object.fromEntries(ends.map((e) => [e, {}]));

  for (const [key, def] of Object.entries(FIELDS)) {
    const unit = def.unit || 'USD';
    for (const tag of def.sec) {
      // Latest-filed value per period end (i.e. as most recently reported / restated).
      const best = {};
      for (const f of unitsOf(tag, unit)) {
        if (!ANNUAL_FORMS.has(f.form)) continue;
        if (def.kind === 'flow' ? !isAnnualFlow(f) : f.start) continue;
        const end = matchEnd(f.end);
        if (!end) continue;
        if (!best[end] || f.filed > best[end].filed) best[end] = f;
      }
      for (const [end, f] of Object.entries(best)) {
        if (periods[end][key] != null) continue;
        periods[end][key] = f.val;
        sources[end][key] = { accn: f.accn, form: f.form, filed: f.filed, tag };
      }
    }
  }

  return { periods: ends.map((e) => periods[e]), sources };
}

export function recentFilings(subs, n = 25) {
  const r = subs?.filings?.recent;
  if (!r) return [];
  const out = [];
  for (let i = 0; i < r.form.length && out.length < n; i++) {
    if (!/^(10-K|10-Q|8-K|20-F|6-K|DEF 14A|S-1)/.test(r.form[i])) continue;
    out.push({
      form: r.form[i],
      filed: r.filingDate[i],
      period: r.reportDate[i],
      description: r.primaryDocDescription?.[i] || '',
      url: `https://www.sec.gov/Archives/edgar/data/${Number(subs.cik)}/${r.accessionNumber[i].replace(/-/g, '')}/${r.primaryDocument[i]}`,
      index: filingUrl(subs.cik, r.accessionNumber[i]),
      items: r.items?.[i] || '',
    });
  }
  return out;
}

export function latestAnnualReport(subs) {
  return annualReports(subs)[0] || null;
}

// Every annual report in the recent filings list, newest first.
export function annualReports(subs) {
  return recentFilings(subs, 1000).filter((f) => f.form === '10-K' || f.form === '20-F');
}

// Plain-text extraction without a DOM, so it runs in Node, browsers and workers.
export function htmlToText(html) {
  return html
    .replace(/<ix:header>[\s\S]*?<\/ix:header>/gi, ' ')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|tr|li|h\d|table|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;|&#8220;|&#8221;/g, '"').replace(/&#39;|&#8217;|&#8216;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#8212;|&mdash;/g, '—').replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#\d+;/g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export const TENK_SECTIONS = {
  business: { title: 'Business', start: /item\s*1\.?\s*business/gi, end: /item\s*1a\.?\s*risk\s*factors/gi },
  risk: { title: 'Risk factors', start: /item\s*1a\.?\s*risk\s*factors/gi, end: /item\s*(1b|1c|2)\.?\s*(unresolved|cybersecurity|properties)/gi },
  mdna: { title: "Management's discussion & analysis", start: /item\s*7\.?\s*management'?s\s*discussion/gi, end: /item\s*(7a|8)\.?\s*(quantitative|financial\s*statements)/gi },
};

// Full text of Business, Risk Factors and MD&A. The table of contents repeats
// every heading, so for each section the longest candidate wins.
export function extract10KSectionMap(text) {
  const out = {};
  for (const [key, { start, end }] of Object.entries(TENK_SECTIONS)) {
    let best = '';
    for (const m of text.matchAll(start)) {
      end.lastIndex = m.index + m[0].length;
      const e = end.exec(text);
      const body = text.slice(m.index, e ? e.index : m.index + 200000);
      if (body.length > best.length) best = body;
    }
    out[key] = best.length > 500 ? best : '';
  }
  return out;
}

// Condensed version for a single prompt: each section trimmed to a share of maxChars.
export function extract10KSections(text, maxChars = 110000) {
  const map = extract10KSectionMap(text);
  const budget = { business: 0.25, risk: 0.35, mdna: 0.4 };
  return Object.entries(TENK_SECTIONS)
    .filter(([key]) => map[key])
    .map(([key, { title }]) => `## ${title}\n${map[key].slice(0, Math.floor(maxChars * budget[key]))}`)
    .join('\n\n');
}
