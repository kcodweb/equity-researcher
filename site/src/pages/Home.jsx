import { useState } from 'react';
import { useIndex, stockHref, getRecent, go } from '../lib/store.js';
import { fmtMoney, fmtPrice, fmtPct, fmtNum, fmtDate } from '../../../core/format.js';
import { Card, Delta, SignedPct, Severity, ThesisStatus, Seg, Loading, SevIcon } from '../components/ui.jsx';

export default function Home() {
  const index = useIndex();
  const [market, setMarket] = useState('all');
  const recent = getRecent();
  if (!index) return <Loading />;
  const items = index.items.filter((i) => market === 'all' || i.market === market);

  return (
    <div className="stack">
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ fontSize: 22 }}>Research watchlist</h1>
          <div className="text2" style={{ marginTop: 4 }}>
            {index.items.length} companies researched daily · last build {index.generatedAt ? fmtDate(index.generatedAt) : 'never'}
          </div>
        </div>
        <div className="spacer" />
        <Seg options={[['all', 'All'], ['US', 'US'], ['IN', 'India']]} value={market} onChange={setMarket} />
      </div>

      {!index.items.length && (
        <div className="notice warn">No research data yet. Run <code>npm run pipeline</code> locally, or trigger the “Daily research” GitHub Action.</div>
      )}

      {items.length > 0 && (
        <Card>
          <div className="table-wrap">
            <table className="watch clickable">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Price</th>
                  <th>1D</th>
                  <th>1Y</th>
                  <th>Mkt cap</th>
                  <th>P/E</th>
                  <th title="Piotroski F-score">F-score</th>
                  <th title="Altman Z-score zone">Altman</th>
                  <th>Red flags</th>
                  <th title="Upside to base-case DCF">DCF upside</th>
                  <th title="Growth rate the current price implies (reverse DCF)">Implied growth</th>
                  <th>Thesis</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.symbol} onClick={() => go(`s/${encodeURIComponent(i.symbol)}`)}>
                    <td>
                      <a href={stockHref(i.symbol)} onClick={(e) => e.stopPropagation()}><b>{i.symbol}</b></a>
                      <div className="name">{i.name}</div>
                    </td>
                    <td>{fmtPrice(i.price, i.currency)}</td>
                    <td><Delta v={i.changePct} /></td>
                    <td><SignedPct v={i.return1y} /></td>
                    <td>{fmtMoney(i.marketCap, i.currency)}</td>
                    <td>{fmtNum(i.trailingPE, 1)}</td>
                    <td>{i.piotroski || '—'}</td>
                    <td>{i.altmanZone ? <Severity level={i.altmanZone === 'Safe' ? 'good' : i.altmanZone === 'Grey' ? 'warning' : 'critical'} label={i.altmanZone} /> : <span className="muted">n/a</span>}</td>
                    <td><FlagCounts flags={i.flags} /></td>
                    <td><SignedPct v={i.upside} digits={0} /></td>
                    <td>{fmtPct(i.impliedGrowth)}</td>
                    <td>{i.error ? <Severity level="critical" label="Update failed" /> : <ThesisStatus status={i.thesisStatus} short />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid g2">
        <Card title="Recently viewed">
          {recent.length ? (
            <div className="list">
              {recent.map((r) => (
                <a key={r.symbol} className="list-item row" href={stockHref(r.symbol)}>
                  <b>{r.symbol}</b><span className="text2">{r.name}</span>
                </a>
              ))}
            </div>
          ) : <div className="muted">Stocks you open will appear here.</div>}
        </Card>
        <Card title="How this workbench works">
          <ul style={{ margin: 0, paddingLeft: 18 }} className="text2">
            <li>Every weekday a GitHub Action researches the watchlist in <code>config.yml</code>: financials, forensic scan, valuation, risk and peers.</li>
            <li>Write a thesis with measurable KPIs in <code>theses/SYMBOL.yml</code> — each build checks it against the newest numbers.</li>
            <li>Gemini writes an analyst-style note when new results arrive (US notes read the latest 10-K).</li>
            <li>Search any other stock for a live analysis via the data proxy.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function FlagCounts({ flags }) {
  if (!flags) return <span className="muted">—</span>;
  const parts = ['critical', 'serious', 'warning'].filter((k) => flags[k] > 0);
  if (!parts.length) return <Severity level="good" label="None" />;
  return (
    <span className="flagcount">
      {parts.map((k) => (
        <span key={k} className="sev" title={`${flags[k]} ${k}`}><SevIcon level={k} size={14} />{flags[k]}</span>
      ))}
    </span>
  );
}
