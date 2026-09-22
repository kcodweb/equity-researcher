import { useEffect, useRef, useState } from 'react';
import { useRoute, useIndex, useSettings, workerUrlFrom, searchSymbols, go } from './lib/store.js';
import Home from './pages/Home.jsx';
import Stock from './pages/Stock.jsx';
import Settings from './pages/Settings.jsx';
import About from './pages/About.jsx';

export default function App() {
  const route = useRoute();
  const [section, symbol, tab] = route.parts;
  let page;
  if (section === 's' && symbol) page = <Stock key={symbol} symbol={symbol.toUpperCase()} tab={tab || 'overview'} />;
  else if (section === 'settings') page = <Settings />;
  else if (section === 'about') page = <About />;
  else page = <Home />;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/">
            <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
              <rect width="32" height="32" rx="7" fill="var(--accent)" />
              <path d="M7 22l6-7 5 4 7-9" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Equity Researcher
          </a>
          <Search />
          <nav className="nav">
            <a href="#/" className={!section ? 'active' : ''}>Watchlist</a>
            <a href="#/about" className={section === 'about' ? 'active' : ''}>Method</a>
            <a href="#/settings" className={section === 'settings' ? 'active' : ''}>Settings</a>
          </nav>
        </div>
      </header>
      <main className="page">{page}</main>
      <footer className="footer">
        Data: SEC EDGAR, Yahoo Finance. Research tool, not investment advice — verify figures against filings before acting.
      </footer>
    </>
  );
}

function Search() {
  const index = useIndex();
  const settings = useSettings();
  const workerUrl = workerUrlFrom(settings, index);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState([]);
  const [hi, setHi] = useState(0);
  const box = useRef(null);

  const local = q.trim()
    ? (index?.items || []).filter((i) => `${i.symbol} ${i.name}`.toLowerCase().includes(q.trim().toLowerCase())).map((i) => ({ symbol: i.symbol, name: i.name, exchange: 'Watchlist' }))
    : [];
  const results = [...local, ...remote.filter((r) => !local.some((l) => l.symbol === r.symbol))].slice(0, 12);

  useEffect(() => {
    if (!workerUrl || q.trim().length < 2) { setRemote([]); return undefined; }
    const t = setTimeout(() => {
      searchSymbols(workerUrl, q.trim()).then(setRemote).catch(() => setRemote([]));
    }, 280);
    return () => clearTimeout(t);
  }, [q, workerUrl]);

  useEffect(() => {
    const onDoc = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const choose = (symbol) => {
    setOpen(false);
    setQ('');
    go(`s/${encodeURIComponent(symbol.toUpperCase())}`);
  };

  return (
    <div className="search" ref={box}>
      <svg className="icon" width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" fill="none" />
        <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        type="text"
        placeholder={workerUrl ? 'Search any stock — AAPL, Infosys, RELIANCE.NS…' : 'Search watchlist or type a ticker…'}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          if (e.key === 'Enter' && q.trim()) choose(results[hi]?.symbol || q.trim());
          if (e.key === 'Escape') setOpen(false);
        }}
        aria-label="Search stocks"
      />
      {open && q.trim() && (
        <div className="search-results">
          {results.map((r, i) => (
            <button key={r.symbol} className={i === hi ? 'hi' : ''} onMouseEnter={() => setHi(i)} onClick={() => choose(r.symbol)}>
              <span className="sym">{r.symbol}</span>
              <span className="nm">{r.name}</span>
              <span className="ex">{r.exchange}</span>
            </button>
          ))}
          {!results.length && (
            <div className="hint">
              Press Enter to open <b>{q.trim().toUpperCase()}</b>
              {!workerUrl && ' — live lookup of stocks outside the watchlist needs the data proxy (see Settings).'}
            </div>
          )}
          {!workerUrl && results.length > 0 && <div className="hint">Showing watchlist only. Add a data proxy in Settings to search every stock.</div>}
        </div>
      )}
    </div>
  );
}
