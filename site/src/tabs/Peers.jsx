import { useState } from 'react';
import { fmtMoney, fmtPct, fmtNum, fmtPrice } from '../../../core/format.js';
import { Card, Seg, Empty, SignedPct } from '../components/ui.jsx';
import { RankBars } from '../components/charts.jsx';
import { stockHref } from '../lib/store.js';

const METRICS = [
  ['trailingPE', 'P/E', 'num', 'down'],
  ['forwardPE', 'Fwd P/E', 'num', 'down'],
  ['evToEbitda', 'EV/EBITDA', 'num', 'down'],
  ['priceToBook', 'P/B', 'num', 'down'],
  ['priceToSales', 'P/S', 'num', 'down'],
  ['grossMargin', 'Gross margin', 'pct', 'up'],
  ['operatingMargin', 'Op. margin', 'pct', 'up'],
  ['netMargin', 'Net margin', 'pct', 'up'],
  ['roe', 'ROE', 'pct', 'up'],
  ['revenueGrowth', 'Rev. growth', 'pct', 'up'],
  ['earningsGrowth', 'EPS growth', 'pct', 'up'],
  ['debtToEquity', 'Debt/equity', 'num', 'down'],
  ['dividendYield', 'Div. yield', 'pct', 'up'],
  ['return1y', '1Y return', 'pct', 'up'],
];

export default function Peers({ data, a, symbol }) {
  const [metric, setMetric] = useState('trailingPE');
  if (!data.peers?.length) return <Empty>No peers found. Set a peer list for this ticker in config.yml.</Empty>;

  const q = data.quote;
  const self = {
    symbol, name: data.profile.name, currency: data.currency, price: q.price, marketCap: q.marketCap,
    trailingPE: q.trailingPE, forwardPE: q.forwardPE, evToEbitda: q.evToEbitda, priceToBook: q.priceToBook, priceToSales: q.priceToSales,
    grossMargin: q.ttm?.grossMargin, operatingMargin: q.ttm?.operatingMargin, netMargin: q.ttm?.netMargin, roe: q.ttm?.roe,
    revenueGrowth: q.ttm?.revenueGrowth, earningsGrowth: q.ttm?.earningsGrowth,
    debtToEquity: a.latest.debtToEquity != null ? a.latest.debtToEquity * 100 : null, dividendYield: q.dividendYield,
    return1y: a.risk?.trailing?.find((t) => t.label === '1Y')?.stock,
  };
  const rows = [self, ...data.peers];
  const def = METRICS.find((m) => m[0] === metric);
  const fmt = (m, v) => (m[2] === 'pct' ? fmtPct(v) : fmtNum(v, 1));

  // Percentile rank of the subject within the group (100 = best).
  const rank = (m) => {
    const vals = rows.map((r) => r[m[0]]).filter((v) => Number.isFinite(v) && (m[3] === 'up' || v > 0));
    const mine = self[m[0]];
    if (!Number.isFinite(mine) || vals.length < 2) return null;
    const better = vals.filter((v) => (m[3] === 'up' ? v < mine : v > mine)).length;
    return Math.round((better / (vals.length - 1)) * 100);
  };
  const median = (m) => {
    const vals = data.peers.map((r) => r[m[0]]).filter(Number.isFinite).sort((x, y) => x - y);
    if (!vals.length) return null;
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  };

  const barData = rows
    .filter((r) => Number.isFinite(r[metric]) && (def[3] === 'up' || r[metric] > 0))
    .map((r) => ({ label: r.symbol, value: r[metric] }))
    .sort((x, y) => y.value - x.value);

  return (
    <div className="stack">
      <Card title="Peer comparison" sub={`${data.peers.length} peers · trailing-twelve-month figures from Yahoo Finance · debt/equity in %`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th><th>Price</th><th>Mkt cap</th>
                {METRICS.map((m) => <th key={m[0]}>{m[1]}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol} className={r.symbol === symbol ? 'hl' : ''}>
                  <td>
                    {r.symbol === symbol ? <b>{r.symbol}</b> : <a href={stockHref(r.symbol)}>{r.symbol}</a>}
                    <div className="small muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                  </td>
                  <td>{fmtPrice(r.price, r.currency)}</td>
                  <td>{fmtMoney(r.marketCap, r.currency)}</td>
                  {METRICS.map((m) => <td key={m[0]}>{m[0] === 'return1y' ? <SignedPct v={r[m[0]]} /> : fmt(m, r[m[0]])}</td>)}
                </tr>
              ))}
              <tr>
                <td className="lbl">Peer median</td><td /><td />
                {METRICS.map((m) => <td key={m[0]} className="lbl">{fmt(m, median(m))}</td>)}
              </tr>
              <tr>
                <td className="lbl" title="Share of peers the company beats on this metric (lower multiples and debt count as better)">{symbol} percentile</td><td /><td />
                {METRICS.map((m) => { const p = rank(m); return <td key={m[0]}>{p == null ? '—' : <b>{p}</b>}</td>; })}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`${def[1]} across the peer group`} sub={def[3] === 'down' ? 'Lower is cheaper / safer' : 'Higher is better'}
        right={<select value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Metric">{METRICS.map((m) => <option key={m[0]} value={m[0]}>{m[1]}</option>)}</select>}>
        {barData.length ? <RankBars data={barData} valueKey="value" highlight={symbol} fmt={(v) => fmt(def, v)} /> : <div className="muted">No data for this metric.</div>}
        <div className="small muted">Highlighted: {symbol}. Peers can be set per ticker in config.yml.</div>
      </Card>
    </div>
  );
}
