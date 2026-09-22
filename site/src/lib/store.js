import { useEffect, useState, useSyncExternalStore } from 'react';
import { createYahoo } from '../../../core/sources/yahoo.js';
import { createSec, htmlToText, extract10KSections } from '../../../core/sources/sec.js';
import { researchTicker } from '../../../core/research.js';

// ---------- Settings (per-browser, localStorage) ----------
const KEYS = { workerUrl: 'er:worker', geminiKey: 'er:gemini', geminiModel: 'er:geminiModel', theme: 'er:theme' };
const listeners = new Set();
function read(k) {
  try { return localStorage.getItem(k) || ''; } catch { return ''; }
}
let settingsCache = null;
function snapshot() {
  if (!settingsCache) settingsCache = Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, read(v)]));
  return settingsCache;
}
export function setSettings(patch) {
  for (const [k, v] of Object.entries(patch)) {
    try {
      if (v) localStorage.setItem(KEYS[k], v); else localStorage.removeItem(KEYS[k]);
    } catch { /* storage unavailable: keep in memory only */ }
  }
  settingsCache = { ...snapshot(), ...patch };
  if ('theme' in patch) applyTheme(patch.theme);
  listeners.forEach((l) => l());
}
export function useSettings() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, snapshot);
}
export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
}

// ---------- Hash router ----------
function currentRoute() {
  const h = decodeURIComponent(window.location.hash.replace(/^#\/?/, ''));
  const [path, query = ''] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, query: new URLSearchParams(query) };
}
export function useRoute() {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const on = () => { setRoute(currentRoute()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
export const go = (path) => { window.location.hash = `#/${path}`; };
export const stockHref = (symbol, tab) => `#/s/${encodeURIComponent(symbol)}${tab ? `/${tab}` : ''}`;

// ---------- Data ----------
export const fileKey = (symbol) => symbol.toUpperCase().replace(/[^A-Z0-9.-]/g, '_');

let indexPromise = null;
export function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch('data/index.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .catch(() => ({ items: [] }));
  }
  return indexPromise;
}

export function useIndex() {
  const [index, setIndex] = useState(null);
  useEffect(() => { loadIndex().then(setIndex); }, []);
  return index;
}

export async function loadSnapshot(symbol) {
  const r = await fetch(`data/tickers/${fileKey(symbol)}.json`, { cache: 'no-cache' });
  if (!r.ok) return null;
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('json')) return null; // SPA fallbacks can return HTML
  return r.json();
}

export function workerUrlFrom(settings, index) {
  return (settings.workerUrl || index?.workerUrl || '').replace(/\/+$/, '');
}

export function clientsFor(workerUrl) {
  const yahoo = createYahoo({ base: `${workerUrl}/yahoo`, direct: false });
  const sec = createSec({ dataBase: `${workerUrl}/sec-data`, wwwBase: `${workerUrl}/sec-www` });
  return { yahoo, sec };
}

export async function liveResearch(symbol, workerUrl, markets) {
  const { yahoo, sec } = clientsFor(workerUrl);
  const data = await researchTicker(symbol, { yahoo, sec, markets: markets || undefined });
  data.live = true;
  return data;
}

export async function fetchAnnualReportText(workerUrl, data) {
  if (!workerUrl || !data.annualReport?.url) return '';
  const { sec } = clientsFor(workerUrl);
  try {
    return extract10KSections(htmlToText(await sec.document(data.annualReport.url)));
  } catch {
    return '';
  }
}

export async function searchSymbols(workerUrl, q) {
  if (!workerUrl) return [];
  const { yahoo } = clientsFor(workerUrl);
  return (await yahoo.search(q, { quotes: 10 })).quotes;
}

// ---------- Local theses (drafts kept in this browser) ----------
export function loadLocalThesis(symbol) {
  try { return JSON.parse(localStorage.getItem(`er:thesis:${fileKey(symbol)}`) || 'null'); } catch { return null; }
}
export function saveLocalThesis(symbol, thesis) {
  try {
    if (thesis) localStorage.setItem(`er:thesis:${fileKey(symbol)}`, JSON.stringify(thesis));
    else localStorage.removeItem(`er:thesis:${fileKey(symbol)}`);
  } catch { /* ignore */ }
}

// ---------- Recently viewed ----------
export function pushRecent(item) {
  try {
    const list = JSON.parse(localStorage.getItem('er:recent') || '[]').filter((x) => x.symbol !== item.symbol);
    list.unshift(item);
    localStorage.setItem('er:recent', JSON.stringify(list.slice(0, 8)));
  } catch { /* ignore */ }
}
export function getRecent() {
  try { return JSON.parse(localStorage.getItem('er:recent') || '[]'); } catch { return []; }
}
