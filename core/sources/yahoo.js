// Yahoo Finance client. Works in Node (direct, handles cookie + crumb itself)
// and in the browser (through the Cloudflare Worker, which injects the crumb).

const DEFAULT_BASE = 'https://query2.finance.yahoo.com';
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

let crumbCache = null;

// Yahoo requires a session cookie + crumb for quoteSummary / quote endpoints.
export async function getCrumb(fetchImpl = fetch, force = false) {
  if (!force && crumbCache && crumbCache.expires > Date.now()) return crumbCache;
  const r1 = await fetchImpl('https://fc.yahoo.com', { headers: { 'User-Agent': BROWSER_UA }, redirect: 'manual' });
  const raw = typeof r1.headers.getSetCookie === 'function' ? r1.headers.getSetCookie() : [r1.headers.get('set-cookie') || ''];
  const cookie = raw.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
  const r2 = await fetchImpl(`${DEFAULT_BASE}/v1/test/getcrumb`, { headers: { 'User-Agent': BROWSER_UA, cookie } });
  const crumb = (await r2.text()).trim();
  if (!r2.ok || !crumb || crumb.includes('<')) throw new Error(`Yahoo crumb request failed (${r2.status})`);
  crumbCache = { cookie, crumb, expires: Date.now() + 30 * 60 * 1000 };
  return crumbCache;
}

export function createYahoo({ base = DEFAULT_BASE, fetchImpl = fetch, direct = true } = {}) {
  async function get(path, { needsCrumb = false } = {}) {
    let url = `${base}${path}`;
    const headers = {};
    if (direct) {
      headers['User-Agent'] = BROWSER_UA;
      if (needsCrumb) {
        const { cookie, crumb } = await getCrumb(fetchImpl);
        headers.cookie = cookie;
        url += `${url.includes('?') ? '&' : '?'}crumb=${encodeURIComponent(crumb)}`;
      }
    }
    let res = await fetchImpl(url, { headers });
    if (direct && needsCrumb && res.status === 401) {
      const { cookie, crumb } = await getCrumb(fetchImpl, true);
      headers.cookie = cookie;
      url = url.replace(/crumb=[^&]*/, `crumb=${encodeURIComponent(crumb)}`);
      res = await fetchImpl(url, { headers });
    }
    if (!res.ok) throw new Error(`Yahoo ${res.status} for ${path.split('?')[0]}`);
    return res.json();
  }

  return {
    async chart(symbol, range = '10y', interval = '1d') {
      const j = await get(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&events=div%2Csplit&includeAdjustedClose=true`);
      const r = j.chart?.result?.[0];
      if (!r) throw new Error(`No price data for ${symbol}`);
      const off = r.meta.gmtoffset || 0;
      const toDate = (t) => new Date((t + off) * 1000).toISOString().slice(0, 10);
      const q = r.indicators.quote[0] || {};
      const adj = r.indicators.adjclose?.[0]?.adjclose || q.close;
      const rows = [];
      (r.timestamp || []).forEach((t, i) => {
        if (q.close[i] == null) return;
        rows.push([toDate(t), round(q.close[i]), round(adj[i] ?? q.close[i]), q.volume?.[i] ?? null]);
      });
      const dividends = Object.values(r.events?.dividends || {}).map((d) => [toDate(d.date), d.amount]).sort();
      const splits = Object.values(r.events?.splits || {}).map((s) => [toDate(s.date), `${s.numerator}:${s.denominator}`]).sort();
      return { meta: r.meta, rows: dedupe(rows), dividends, splits };
    },

    // Returns { TypeName: [{ date, value }] } for the given prefix (annual | quarterly | trailing).
    async timeseries(symbol, prefix, types) {
      const now = Math.floor(Date.now() / 1000);
      const all = types.map((t) => prefix + t).join(',');
      const j = await get(`/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=${all}&period1=493590046&period2=${now}`);
      const out = {};
      for (const res of j.timeseries?.result || []) {
        const full = res.meta?.type?.[0];
        if (!full || !res[full]) continue;
        out[full.slice(prefix.length)] = res[full]
          .filter((x) => x && x.reportedValue && x.reportedValue.raw != null)
          .map((x) => ({ date: x.asOfDate, value: x.reportedValue.raw, currency: x.currencyCode }));
      }
      return out;
    },

    async quoteSummary(symbol, modules) {
      const j = await get(`/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules.join(',')}`, { needsCrumb: true });
      const r = j.quoteSummary?.result?.[0];
      if (!r) throw new Error(j.quoteSummary?.error?.description || `No summary for ${symbol}`);
      return r;
    },

    async recommendations(symbol) {
      const j = await get(`/v6/finance/recommendationsbysymbol/${encodeURIComponent(symbol)}`);
      return (j.finance?.result?.[0]?.recommendedSymbols || []).map((x) => x.symbol);
    },

    async search(q, { quotes = 8, news = 0 } = {}) {
      const j = await get(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=${quotes}&newsCount=${news}&enableFuzzyQuery=false`);
      return {
        quotes: (j.quotes || []).filter((x) => x.symbol && (x.quoteType === 'EQUITY' || x.quoteType === 'ETF')).map((x) => ({
          symbol: x.symbol, name: x.longname || x.shortname || x.symbol, exchange: x.exchDisp || x.exchange, type: x.quoteType,
        })),
        news: (j.news || []).map((n) => ({
          title: n.title, publisher: n.publisher, link: n.link,
          time: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : null,
        })),
      };
    },
  };
}

function round(x) {
  return x == null ? null : Math.round(x * 10000) / 10000;
}

function dedupe(rows) {
  const out = [];
  for (const r of rows) {
    if (out.length && out[out.length - 1][0] === r[0]) out[out.length - 1] = r;
    else out.push(r);
  }
  return out;
}

// Unwraps Yahoo's {raw, fmt} numbers.
export const raw = (x) => (x && typeof x === 'object' && 'raw' in x ? x.raw : typeof x === 'number' ? x : null);
