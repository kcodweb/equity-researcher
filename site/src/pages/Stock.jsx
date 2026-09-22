import { useCallback, useEffect, useMemo, useState } from 'react';
import { analyze } from '../../../core/analysis/index.js';
import { fmtPrice, fmtMoney, fmtDate } from '../../../core/format.js';
import {
  useIndex, useSettings, loadSnapshot, liveResearch, workerUrlFrom, stockHref, pushRecent, loadLocalThesis, saveLocalThesis,
} from '../lib/store.js';
import { Delta, Loading, ThesisStatus } from '../components/ui.jsx';
import Overview from '../tabs/Overview.jsx';
import Financials from '../tabs/Financials.jsx';
import Quality from '../tabs/Quality.jsx';
import Valuation from '../tabs/Valuation.jsx';
import Risk from '../tabs/Risk.jsx';
import Peers from '../tabs/Peers.jsx';
import Ownership from '../tabs/Ownership.jsx';
import Thesis from '../tabs/Thesis.jsx';
import AiNote from '../tabs/AiNote.jsx';

const TABS = [
  ['overview', 'Overview', Overview],
  ['financials', 'Financials', Financials],
  ['quality', 'Quality & forensics', Quality],
  ['valuation', 'Valuation lab', Valuation],
  ['risk', 'Risk & returns', Risk],
  ['peers', 'Peers', Peers],
  ['ownership', 'Ownership & Street', Ownership],
  ['thesis', 'Thesis', Thesis],
  ['ai', 'AI note', AiNote],
];

export default function Stock({ symbol, tab }) {
  const index = useIndex();
  const settings = useSettings();
  const workerUrl = workerUrlFrom(settings, index);
  const [state, setState] = useState({ status: 'loading' });
  const [localThesis, setLocalThesis] = useState(() => loadLocalThesis(symbol));

  const runLive = useCallback(async (snapshot) => {
    setState((s) => ({ ...s, refreshing: true }));
    try {
      const live = await liveResearch(symbol, workerUrl, index?.markets);
      // Keep what only the daily build produces (AI note, thesis, holding history).
      if (snapshot) {
        live.aiNote = snapshot.aiNote;
        live.thesis = snapshot.thesis;
        live.holdingHistory = snapshot.holdingHistory;
      }
      setState({ status: 'ready', data: live, source: 'live' });
    } catch (e) {
      setState((s) => (s.data ? { ...s, refreshing: false, liveError: e.message } : { status: 'error', error: e.message }));
    }
  }, [symbol, workerUrl, index]);

  useEffect(() => {
    if (!index) return;
    let cancelled = false;
    (async () => {
      const snap = await loadSnapshot(symbol).catch(() => null);
      if (cancelled) return;
      if (snap) setState({ status: 'ready', data: snap, source: 'snapshot' });
      else if (workerUrl) runLive(null);
      else setState({ status: 'missing' });
    })();
    return () => { cancelled = true; };
  }, [symbol, index]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = state.data;
  const thesis = localThesis || data?.thesis || null;
  const analysis = useMemo(() => (data ? analyze(data, { thesis }) : null), [data, thesis]);

  useEffect(() => {
    if (data) {
      pushRecent({ symbol, name: data.profile.name });
      document.title = `${symbol} · ${data.profile.name} — Equity Researcher`;
    }
    return () => { document.title = 'Equity Researcher'; };
  }, [data, symbol]);

  const updateThesis = (t) => {
    saveLocalThesis(symbol, t);
    setLocalThesis(t);
  };

  if (state.status === 'loading' || !index) return <Loading text={`Researching ${symbol}…`} />;
  if (state.status === 'missing') {
    return (
      <div className="notice warn">
        <b>{symbol}</b> isn't on the watchlist and live lookup isn't set up yet. Add it to <code>config.yml</code>, or deploy the data proxy and add its URL in <a href="#/settings">Settings</a>.
      </div>
    );
  }
  if (state.status === 'error') {
    return <div className="notice err">Couldn't research <b>{symbol}</b>: {state.error}. Check the ticker (Indian stocks need .NS or .BO).</div>;
  }

  const { profile, quote, currency } = data;
  const current = TABS.find((t) => t[0] === tab) || TABS[0];
  const TabComponent = current[2];

  return (
    <div>
      <div className="stock-head">
        <div>
          <h1>{profile.name}</h1>
          <div className="meta">
            <b>{symbol}</b>
            <span>·</span><span>{profile.exchange}</span>
            {profile.sector && (<><span>·</span><span>{profile.sector}</span></>)}
            {profile.industry && (<><span>·</span><span>{profile.industry}</span></>)}
          </div>
        </div>
        <div>
          <div className="price-big">{fmtPrice(quote.price, currency)}</div>
          <div className="row" style={{ gap: 8 }}>
            <Delta v={quote.changePct} />
            <span className="text2">Mkt cap {fmtMoney(quote.marketCap, currency)}</span>
          </div>
        </div>
        <div className="spacer" />
        <div style={{ textAlign: 'right' }}>
          {analysis.thesis && <div style={{ marginBottom: 6 }}><ThesisStatus status={analysis.thesis.status} /></div>}
          <div className="small muted">
            {state.source === 'live' ? 'Live analysis' : 'Daily snapshot'} · {fmtDate(data.generatedAt)} · {data.dataSource}
          </div>
          {workerUrl && (
            <button className="btn small" style={{ marginTop: 6 }} onClick={() => runLive(data)} disabled={state.refreshing}>
              {state.refreshing ? 'Refreshing…' : 'Refresh live'}
            </button>
          )}
          {state.liveError && <div className="small down" style={{ marginTop: 4 }}>Live refresh failed: {state.liveError}</div>}
        </div>
      </div>

      <nav className="tabs" aria-label="Research sections">
        {TABS.map(([id, label]) => (
          <button key={id} className={current[0] === id ? 'active' : ''} onClick={() => { window.location.hash = stockHref(symbol, id); }}>
            {label}
          </button>
        ))}
      </nav>

      <TabComponent data={data} a={analysis} symbol={symbol} thesis={thesis} localThesis={localThesis} onThesisChange={updateThesis} workerUrl={workerUrl} source={state.source} />
    </div>
  );
}
