// Shared by the daily build and the research CLI.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { DEFAULT_MARKETS } from '../core/research.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'site', 'public', 'data');

export const fileKey = (symbol) => symbol.toUpperCase().replace(/[^A-Z0-9.-]/g, '_');

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
}

export function loadConfig() {
  const cfg = yaml.load(fs.readFileSync(path.join(ROOT, 'config.yml'), 'utf8')) || {};
  cfg.watchlist = (cfg.watchlist || []).map((w) => (typeof w === 'string' ? { symbol: w } : w));
  cfg.markets = { ...DEFAULT_MARKETS, ...(cfg.markets || {}) };
  for (const k of Object.keys(DEFAULT_MARKETS)) cfg.markets[k] = { ...DEFAULT_MARKETS[k], ...(cfg.markets[k] || {}) };
  cfg.ai = { enabled: true, model: 'gemini-3.8-flash', fallbackModel: 'gemini-3.5-flash-lite', refreshDays: 30, googleSearch: true, ...(cfg.ai || {}) };
  return cfg;
}

export function loadThesis(symbol, warn = (m) => console.error(m)) {
  const file = path.join(ROOT, 'theses', `${fileKey(symbol)}.yml`);
  if (!fs.existsSync(file)) return null;
  try { return yaml.load(fs.readFileSync(file, 'utf8')); } catch (e) { warn(`  ! thesis ${symbol}: ${e.message}`); return null; }
}
