// Cloudflare Worker: a narrow, cached CORS proxy so the static site can look up
// any ticker live. Yahoo needs a cookie + crumb and SEC needs a contact
// User-Agent — neither can be done from a browser, both are done here.
//   /yahoo/<path>     -> https://query2.finance.yahoo.com/<path>
//   /sec-data/<path>  -> https://data.sec.gov/<path>
//   /sec-www/<path>   -> https://www.sec.gov/<path>   (files/ and Archives/ only)
import { getCrumb, BROWSER_UA } from '../../core/sources/yahoo.js';

const YAHOO_ALLOWED = /^\/(v8\/finance\/chart|v10\/finance\/quoteSummary|v7\/finance\/quote|v6\/finance\/recommendationsbysymbol|v1\/finance\/search|ws\/fundamentals-timeseries)\//;
const NEEDS_CRUMB = /^\/(v10\/finance\/quoteSummary|v7\/finance\/quote)/;

function ttlFor(route, path) {
  if (route === 'sec-www' || route === 'sec-data') return 6 * 3600;
  if (path.includes('fundamentals-timeseries')) return 6 * 3600;
  if (path.includes('/search')) return 900;
  return 300;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes('*') || allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin || '*' : allowed[0] || 'null',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });

    const url = new URL(request.url);
    const [, route, ...rest] = url.pathname.split('/');
    const path = `/${rest.join('/')}`;
    if (route === 'health') return Response.json({ ok: true }, { headers: cors });

    let upstream;
    const headers = { 'User-Agent': BROWSER_UA, Accept: 'application/json, text/html;q=0.9, */*;q=0.8' };
    if (route === 'yahoo') {
      if (!YAHOO_ALLOWED.test(path)) return new Response('Path not allowed', { status: 403, headers: cors });
      upstream = new URL(`https://query2.finance.yahoo.com${path}${url.search}`);
    } else if (route === 'sec-data') {
      if (!/^\/(api\/xbrl\/companyfacts|submissions)\//.test(path)) return new Response('Path not allowed', { status: 403, headers: cors });
      upstream = new URL(`https://data.sec.gov${path}`);
      headers['User-Agent'] = env.SEC_USER_AGENT || 'EquityResearcher research@example.com';
    } else if (route === 'sec-www') {
      if (!/^\/(files\/company_tickers\.json|Archives\/edgar\/data\/)/.test(path)) return new Response('Path not allowed', { status: 403, headers: cors });
      upstream = new URL(`https://www.sec.gov${path}`);
      headers['User-Agent'] = env.SEC_USER_AGENT || 'EquityResearcher research@example.com';
    } else {
      return new Response('Not found', { status: 404, headers: cors });
    }

    // Edge cache keyed on the public URL (crumb excluded).
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) {
      const h = new Headers(hit.headers);
      for (const [k, v] of Object.entries(cors)) h.set(k, v);
      h.set('X-Cache', 'HIT');
      return new Response(hit.body, { status: hit.status, headers: h });
    }

    let res;
    if (route === 'yahoo' && NEEDS_CRUMB.test(path)) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const { cookie, crumb } = await getCrumb(fetch, attempt > 0);
        upstream.searchParams.set('crumb', crumb);
        res = await fetch(upstream, { headers: { ...headers, cookie } });
        if (res.status !== 401 && res.status !== 403) break;
      }
    } else {
      res = await fetch(upstream, { headers });
    }

    const out = new Headers();
    out.set('Content-Type', res.headers.get('Content-Type') || 'application/json');
    for (const [k, v] of Object.entries(cors)) out.set(k, v);
    out.set('Cache-Control', `public, max-age=${ttlFor(route, path)}`);
    out.set('X-Cache', 'MISS');
    const body = await res.arrayBuffer();
    const response = new Response(body, { status: res.status, headers: out });
    if (res.ok) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
