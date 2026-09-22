// AI research note via the Gemini API (free tier). Runs in the pipeline
// (key from a repo secret) and in the browser (key stored locally by the user).
import { fmtMoney, fmtPct, fmtX, fmtNum, fmtPrice } from '../format.js';
import { isNum, hash } from '../util.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

const SYSTEM = `You are a senior buy-side equity research analyst writing an internal initiation note.
Rules:
- Use ONLY the figures supplied in the data pack (or found via search, which you must cite). Never invent numbers.
- When data is missing or ambiguous, say so plainly instead of guessing.
- Be specific and skeptical. Prefer concrete evidence over adjectives. Call out what would change your mind.
- Write in clear, compact Markdown. Use the exact section headings requested. No preamble.
- This is research, not personalised investment advice.`;

const SECTIONS = `Write the note with exactly these sections:
## Verdict
One paragraph: what the business is, the core debate, and whether the current price looks cheap, fair or expensive versus the evidence — with the 2-3 numbers that matter most.
## How the business makes money
Segments, customers, pricing model, unit economics, and cyclicality.
## Moat & competitive position
Evidence for/against durable advantage (returns on capital, margin stability, market share, switching costs, scale). Rate it: None / Narrow / Wide, with reasons.
## Financial quality
Growth quality, margin trends, cash conversion, balance sheet, capital allocation (buybacks, dividends, M&A, capex).
## Forensic read
Interpret the red flags, Beneish/Altman/Piotroski scores and accruals. Which flags are real concerns vs. explainable? What would you verify in the filings?
## Valuation — what is priced in
Explain the reverse-DCF implied growth vs. history and consensus, where the stock sits in its own multiple history, and how peers compare. State the assumptions that would make the base case wrong.
## Bull case / Bear case
Three bullets each, each tied to a measurable driver.
## Key risks
Ranked, most important first.
## What to monitor
4-6 measurable KPIs with thresholds that would confirm or break the thesis (e.g. "operating margin stays above 25%").
## Questions for management
5 sharp questions an analyst would ask on the next earnings call.`;

// Compact, human-readable data pack for the prompt.
export function buildDataPack(data, a, { filingText = '', thesis = null } = {}) {
  const c = data.currency;
  const m = (v) => fmtMoney(v, c);
  const lines = [];
  const P = data.profile;
  lines.push(`# ${P.name} (${data.symbol}) — ${P.exchange || ''}, market: ${data.market}, currency: ${c}`);
  lines.push(`Sector: ${P.sector || 'n/a'} / ${P.industry || 'n/a'}; country: ${P.country || 'n/a'}; employees: ${P.employees ?? 'n/a'}`);
  lines.push(`Business description: ${P.summary || 'n/a'}`);
  const q = data.quote;
  lines.push(`\n## Market data (as of ${data.generatedAt.slice(0, 10)})`);
  lines.push(`Price ${fmtPrice(q.price, c)}; market cap ${m(q.marketCap)}; EV ${m(q.enterpriseValue)}; P/E ttm ${fmtNum(q.trailingPE, 1)}; fwd P/E ${fmtNum(q.forwardPE, 1)}; P/B ${fmtNum(q.priceToBook, 1)}; P/S ${fmtNum(q.priceToSales, 1)}; EV/EBITDA ${fmtNum(q.evToEbitda, 1)}; dividend yield ${fmtPct(q.dividendYield)}; beta ${fmtNum(a.risk?.beta, 2)}`);
  lines.push(`Analysts: ${q.analystCount ?? 0} covering, mean target ${fmtPrice(q.targetMean, c)} (range ${fmtPrice(q.targetLow, c)}–${fmtPrice(q.targetHigh, c)}), consensus "${q.recommendation || 'n/a'}"`);
  const fy1 = data.estimates?.trend?.find((t) => t.period === '0y');
  const fy2 = data.estimates?.trend?.find((t) => t.period === '+1y');
  if (fy1 || fy2) lines.push(`Consensus growth: current FY EPS ${fmtPct(fy1?.growth)}, next FY EPS ${fmtPct(fy2?.growth)}, next FY revenue ${fmtPct(fy2?.revenueGrowth)}`);

  lines.push(`\n## Annual financials (${data.dataSource})`);
  const yrs = data.annual.slice(-8);
  const rs = a.ratios.slice(-8);
  const row = (label, f) => `| ${label} | ${yrs.map((p, i) => f(p, rs[i])).join(' | ')} |`;
  lines.push(`| Metric | ${yrs.map((p) => p.period).join(' | ')} |`);
  lines.push(`|---|${yrs.map(() => '---').join('|')}|`);
  lines.push(row('Revenue', (p) => m(p.revenue)));
  lines.push(row('Revenue growth', (_, r) => fmtPct(r.revenueGrowth)));
  if (!a.isFinancial) lines.push(row('Gross margin', (_, r) => fmtPct(r.grossMargin)));
  lines.push(row('Operating margin', (_, r) => fmtPct(r.operatingMargin)));
  lines.push(row('Net income', (p) => m(p.netIncome)));
  lines.push(row('EPS (diluted)', (_, r) => fmtNum(r.eps, 2)));
  lines.push(row('Operating cash flow', (p) => m(p.cfo)));
  lines.push(row('Free cash flow', (p) => m(p.fcf)));
  lines.push(row('ROE', (_, r) => fmtPct(r.roe)));
  if (!a.isFinancial) lines.push(row('ROIC', (_, r) => fmtPct(r.roic)));
  lines.push(row('Total debt', (p) => m(p.totalDebt)));
  lines.push(row('Equity', (p) => m(p.equity)));
  if (!a.isFinancial) lines.push(row('Net debt / EBITDA', (_, r) => fmtX(r.netDebtToEbitda)));
  lines.push(row('Diluted shares', (p) => fmtNum((p.sharesDiluted ?? p.sharesOutstanding) / 1e6, 0) + 'M'));
  lines.push(row('Dividends + buybacks', (p) => m((p.dividendsPaid || 0) + (p.buybacks || 0))));

  const g = a.growth;
  lines.push(`\nCAGR — revenue 3y ${fmtPct(g.revenue['3y'])}, 5y ${fmtPct(g.revenue['5y'])}, 10y ${fmtPct(g.revenue['10y'])}; EPS 3y ${fmtPct(g.eps['3y'])}, 5y ${fmtPct(g.eps['5y'])}; FCF 5y ${fmtPct(g.fcf['5y'])}`);

  lines.push(`\n## Quality & forensic scores`);
  if (a.piotroski) lines.push(`Piotroski F-score ${a.piotroski.score}/${a.piotroski.max} (${a.piotroski.verdict}); failed tests: ${a.piotroski.tests.filter((t) => t.pass === false).map((t) => t.label).join(', ') || 'none'}`);
  if (a.altman) lines.push(`Altman Z ${fmtNum(a.altman.z, 2)} (${a.altman.zone})`);
  if (a.beneish) lines.push(`Beneish M ${fmtNum(a.beneish.m, 2)} (${a.beneish.zone}); DSRI ${fmtNum(a.beneish.components.DSRI, 2)}, SGI ${fmtNum(a.beneish.components.SGI, 2)}, TATA ${fmtNum(a.beneish.components.TATA, 3)}`);
  lines.push(`Red flags: ${a.redFlags.flags.map((f) => `[${f.severity}] ${f.title} — ${f.detail}`).join(' | ') || 'none detected'}`);
  lines.push(`Strengths: ${a.redFlags.strengths.map((s) => `${s.title} — ${s.detail}`).join(' | ') || 'none detected'}`);

  const v = a.valuation;
  if (v) {
    lines.push(`\n## Valuation model outputs`);
    lines.push(`DCF (${v.inputs.model === 'fcf' ? 'free cash flow' : 'earnings'} based): base cash flow ${m(v.inputs.baseCashFlow)}, growth ${fmtPct(v.inputs.growth)} for 5y fading to ${fmtPct(v.inputs.terminalGrowth)}, discount rate ${fmtPct(v.inputs.discountRate)}`);
    lines.push(`Fair value per share: bear ${fmtPrice(v.fair.bear, c)}, base ${fmtPrice(v.fair.base, c)}, bull ${fmtPrice(v.fair.bull, c)}; base upside ${fmtPct(v.upside)}; terminal value = ${fmtPct(v.terminalShare)} of EV`);
    if (v.reverse) lines.push(`Reverse DCF: current price implies ${fmtPct(v.reverse.impliedGrowth)} annual growth for 5 years`);
    if (v.monteCarlo) lines.push(`Monte Carlo (${v.monteCarlo.runs} runs): P10 ${fmtPrice(v.monteCarlo.p10, c)}, median ${fmtPrice(v.monteCarlo.p50, c)}, P90 ${fmtPrice(v.monteCarlo.p90, c)}; probability value > price ${fmtPct(v.monteCarlo.probAbovePrice)}`);
    const st = v.multiples?.stats;
    if (st?.pe) lines.push(`P/E history since ${v.multiples.from}: current ${fmtNum(st.pe.current, 1)} vs mean ${fmtNum(st.pe.mean, 1)} (±1σ ${fmtNum(st.pe.sd, 1)}), percentile ${fmtPct(st.pe.percentile, 0)}`);
    if (st?.evEbitda) lines.push(`EV/EBITDA history: current ${fmtNum(st.evEbitda.current, 1)} vs mean ${fmtNum(st.evEbitda.mean, 1)}`);
    if (isNum(v.graham)) lines.push(`Graham number ${fmtPrice(v.graham, c)}`);
    if (v.justifiedPB) lines.push(`Justified P/B ${fmtNum(v.justifiedPB.pb, 2)} → ${fmtPrice(v.justifiedPB.value, c)}`);
  }

  const r = a.risk;
  if (r) {
    lines.push(`\n## Risk & price action (vs ${data.benchmark?.name || 'benchmark'})`);
    lines.push(`Beta ${fmtNum(r.beta, 2)}, 1y volatility ${fmtPct(r.vol1y)}, max drawdown ${fmtPct(r.maxDrawdown.dd)} (${r.maxDrawdown.peak} → ${r.maxDrawdown.trough}), current drawdown ${fmtPct(r.currentDrawdown)}, 3y Sharpe ${fmtNum(r.sharpe3y, 2)}`);
    lines.push(`Returns: ${r.trailing.map((t) => `${t.label} ${fmtPct(t.stock)} vs ${fmtPct(t.benchmark)}`).join('; ')}`);
  }

  if (data.peers?.length) {
    lines.push(`\n## Peers`);
    lines.push('| Symbol | Mkt cap | P/E | EV/EBITDA | Op margin | ROE | Rev growth |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const p of data.peers) lines.push(`| ${p.symbol} | ${fmtMoney(p.marketCap, p.currency)} | ${fmtNum(p.trailingPE, 1)} | ${fmtNum(p.evToEbitda, 1)} | ${fmtPct(p.operatingMargin)} | ${fmtPct(p.roe)} | ${fmtPct(p.revenueGrowth)} |`);
  }

  const h = data.holders;
  if (h) lines.push(`\n## Ownership\n${data.market === 'IN' ? 'Promoters/insiders' : 'Insiders'} ${fmtPct(h.insidersPct)}, institutions ${fmtPct(h.institutionsPct)}. Recent insider activity: ${h.insiderTransactions.slice(0, 6).map((t) => `${t.date} ${t.name} ${t.text || ''}`.trim()).join('; ') || 'none reported'}`);

  if (data.news?.length) lines.push(`\n## Recent headlines\n${data.news.slice(0, 10).map((n) => `- ${n.time?.slice(0, 10) || ''} ${n.title} (${n.publisher})`).join('\n')}`);
  if (thesis?.thesis) lines.push(`\n## The owner's current thesis (evaluate it critically)\n${thesis.thesis}`);
  if (filingText) lines.push(`\n## Excerpts from the latest annual report (${data.annualReport?.form || '10-K'} filed ${data.annualReport?.filed || ''})\n${filingText}`);
  return lines.join('\n');
}

export async function callGemini({ apiKey, model, prompt, system = SYSTEM, googleSearch = false, fetchImpl = fetch }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
  };
  if (googleSearch) body.tools = [{ google_search: {} }];
  const res = await fetchImpl(`${ENDPOINT}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(j.error?.message || `Gemini HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const cand = j.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error(`Gemini returned no text (finish reason: ${cand?.finishReason || 'unknown'})`);
  const sources = (cand?.groundingMetadata?.groundingChunks || []).map((g) => g.web).filter(Boolean).map((w) => ({ title: w.title, url: w.uri }));
  return { text, sources, usage: j.usageMetadata || null };
}

// Tries model + search, then without search, then the fallback model.
export async function generateNote({ data, analysis, apiKey, model, fallbackModel, googleSearch = true, filingText = '', thesis = null, fetchImpl = fetch, log = () => {} }) {
  const pack = buildDataPack(data, analysis, { filingText, thesis });
  const prompt = `${SECTIONS}\n\n---\nDATA PACK\n${pack}`;
  const attempts = [];
  for (const m of [model, fallbackModel].filter(Boolean)) {
    if (googleSearch) attempts.push({ model: m, googleSearch: true });
    attempts.push({ model: m, googleSearch: false });
  }
  let lastErr;
  for (const att of attempts) {
    try {
      const out = await callGemini({ apiKey, prompt, fetchImpl, ...att });
      return {
        markdown: out.text,
        sources: out.sources,
        model: att.model,
        grounded: att.googleSearch,
        generatedAt: new Date().toISOString(),
        basis: noteBasis(data),
        usedFiling: Boolean(filingText),
      };
    } catch (e) {
      lastErr = e;
      log(`  ! Gemini ${att.model}${att.googleSearch ? ' +search' : ''}: ${e.message}`);
      if (e.status === 401 || e.status === 403) break; // bad key — no point retrying
    }
  }
  throw lastErr;
}

// Changes when new financial periods arrive, so notes refresh after results.
export function noteBasis(data) {
  const lastA = data.annual.at(-1)?.period || '';
  const lastQ = data.quarterly.at(-1)?.period || '';
  return hash(`${data.symbol}|${lastA}|${lastQ}|${data.annualReport?.filed || ''}`);
}
