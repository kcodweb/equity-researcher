// Daily research build: researches every watchlist ticker and writes static JSON
// for the site into site/public/data. Run: npm run pipeline [-- --only AAPL,TCS.NS]
import path from 'node:path';
import { createYahoo } from '../core/sources/yahoo.js';
import { createSec, htmlToText, extract10KSections } from '../core/sources/sec.js';
import { researchTicker } from '../core/research.js';
import { analyze } from '../core/analysis/index.js';
import { generateNote, noteBasis } from '../core/ai/gemini.js';
import { sleep } from '../core/util.js';
import { DATA_DIR as OUT, fileKey, readJson, writeJson, loadConfig, loadThesis as loadThesisFile } from './config.js';

const log = (...a) => console.log(...a);
const loadThesis = (symbol) => loadThesisFile(symbol, log);

// Snapshot of ownership/price per day; builds the promoter/insider trend over time.
function updateHistory(symbol, data) {
  const file = path.join(OUT, 'history', `${fileKey(symbol)}.json`);
  const hist = readJson(file, []);
  const today = data.generatedAt.slice(0, 10);
  const snap = { date: today, price: data.quote.price, insidersPct: data.holders?.insidersPct ?? null, institutionsPct: data.holders?.institutionsPct ?? null };
  const last = hist.at(-1);
  if (last?.date === today) hist[hist.length - 1] = snap;
  else if (!last || last.insidersPct !== snap.insidersPct || last.institutionsPct !== snap.institutionsPct || hist.length < 2) hist.push(snap);
  else hist[hist.length - 1] = { ...snap }; // unchanged holdings: slide the latest point forward
  writeJson(file, hist);
  return hist;
}

async function annualReportText(sec, data) {
  if (!data.annualReport?.url) return '';
  try {
    const html = await sec.document(data.annualReport.url);
    return extract10KSections(htmlToText(html));
  } catch (e) {
    log(`  ! 10-K text: ${e.message}`);
    return '';
  }
}

async function main() {
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? (args[onlyIdx + 1] || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : null;
  const skipAi = args.includes('--no-ai');

  const cfg = loadConfig();
  const yahoo = createYahoo();
  const sec = createSec({ userAgent: process.env.SEC_USER_AGENT || cfg.secUserAgent });
  const geminiKey = process.env.GEMINI_API_KEY || '';
  const prevIndex = readJson(path.join(OUT, 'index.json'), { items: [] });
  const items = [];

  const list = only ? cfg.watchlist.filter((w) => only.includes(w.symbol.toUpperCase())) : cfg.watchlist;
  log(`Researching ${list.length} ticker(s)${geminiKey && !skipAi && cfg.ai.enabled ? ' with AI notes' : ''}…`);

  for (const entry of list) {
    const symbol = entry.symbol.toUpperCase();
    const t0 = Date.now();
    log(`• ${symbol}`);
    const tickerFile = path.join(OUT, 'tickers', `${fileKey(symbol)}.json`);
    const previous = readJson(tickerFile);
    try {
      const data = await researchTicker(symbol, { yahoo, sec, markets: cfg.markets, peers: entry.peers, log });
      data.holdingHistory = updateHistory(symbol, data);
      const thesis = loadThesis(symbol);
      data.thesis = thesis;
      const a = analyze(data, { thesis });

      // AI note: reuse unless new results arrived or it is older than refreshDays.
      let note = previous?.aiNote || null;
      const stale = !note || note.basis !== noteBasis(data) || Date.now() - new Date(note.generatedAt).getTime() > cfg.ai.refreshDays * 86400000;
      if (cfg.ai.enabled && geminiKey && !skipAi && stale) {
        try {
          const filingText = data.market === 'US' ? await annualReportText(sec, data) : '';
          note = await generateNote({
            data, analysis: a, apiKey: geminiKey, model: cfg.ai.model, fallbackModel: cfg.ai.fallbackModel,
            googleSearch: cfg.ai.googleSearch, filingText, thesis, log,
          });
          log(`  ✓ AI note (${note.model}${note.grounded ? ', search-grounded' : ''})`);
          await sleep(4000); // stay under free-tier requests-per-minute
        } catch (e) {
          log(`  ! AI note failed, keeping previous: ${e.message}`);
        }
      }
      data.aiNote = note;
      writeJson(tickerFile, data);

      items.push(summarize(data, a));
      log(`  ✓ ${((Date.now() - t0) / 1000).toFixed(1)}s — ${data.annual.length}y annual, ${a.redFlags.flags.length} flags${a.thesis ? `, thesis ${a.thesis.status}` : ''}`);
    } catch (e) {
      log(`  ✗ ${symbol}: ${e.message}`);
      const prev = prevIndex.items.find((i) => i.symbol === symbol);
      items.push({ ...(prev || { symbol, name: symbol }), error: e.message, stale: true });
    }
    await sleep(800);
  }

  // Keep entries for tickers not refreshed in an --only run.
  const merged = only
    ? [...prevIndex.items.filter((i) => !only.includes(i.symbol) && cfg.watchlist.some((w) => w.symbol.toUpperCase() === i.symbol)), ...items]
    : items;
  const order = cfg.watchlist.map((w) => w.symbol.toUpperCase());
  merged.sort((x, y) => order.indexOf(x.symbol) - order.indexOf(y.symbol));

  writeJson(path.join(OUT, 'index.json'), {
    generatedAt: new Date().toISOString(),
    workerUrl: cfg.workerUrl || '',
    markets: cfg.markets,
    ai: { model: cfg.ai.model, fallbackModel: cfg.ai.fallbackModel },
    items: merged,
  });
  const failed = items.filter((i) => i.error).length;
  log(`Done: ${items.length - failed} ok, ${failed} failed.`);
  if (failed === items.length && items.length) process.exit(1);
}

function summarize(data, a) {
  const tr1y = a.risk?.trailing?.find((t) => t.label === '1Y');
  const flags = a.redFlags.flags;
  return {
    symbol: data.symbol,
    fileKey: fileKey(data.symbol),
    name: data.profile.name,
    market: data.market,
    currency: data.currency,
    sector: data.profile.sector,
    industry: data.profile.industry,
    price: data.quote.price,
    changePct: data.quote.changePct,
    marketCap: data.quote.marketCap,
    trailingPE: data.quote.trailingPE,
    return1y: tr1y?.stock ?? null,
    piotroski: a.piotroski ? `${a.piotroski.score}/${a.piotroski.max}` : null,
    altmanZone: a.altman?.zone || null,
    flags: { critical: flags.filter((f) => f.severity === 'critical').length, serious: flags.filter((f) => f.severity === 'serious').length, warning: flags.filter((f) => f.severity === 'warning').length },
    fairBase: a.valuation?.fair?.base ?? null,
    upside: a.valuation?.upside ?? null,
    impliedGrowth: a.valuation?.reverse?.impliedGrowth ?? null,
    thesisStatus: a.thesis?.status || null,
    score: a.score,
    hasAiNote: Boolean(data.aiNote),
    updatedAt: data.generatedAt,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
