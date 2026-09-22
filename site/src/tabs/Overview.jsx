import { useMemo, useState } from 'react';
import { sma } from '../../../core/analysis/risk.js';
import { fmtMoney, fmtPrice, fmtPct, fmtNum, fmtX, fmtDate, fmtSignedPct } from '../../../core/format.js';
import { Card, Tile, Meter, Seg, Severity, ThesisStatus } from '../components/ui.jsx';
import { LinesChart } from '../components/charts.jsx';
import { useColors } from '../lib/theme.js';
import { stockHref } from '../lib/store.js';

const RANGES = [['1M', 1], ['6M', 6], ['1Y', 12], ['3Y', 36], ['5Y', 60], ['Max', 999]];

export default function Overview({ data, a, symbol }) {
  const { quote, currency, profile } = data;
  const c = useColors();
  const [range, setRange] = useState('1Y');
  const [mode, setMode] = useState('price');
  const [showSma, setShowSma] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const chart = useMemo(() => {
    const rows = data.prices;
    const closes = rows.map((r) => r[1]);
    const s50 = sma(closes, 50);
    const s200 = sma(closes, 200);
    const months = RANGES.find((r) => r[0] === range)[1];
    const last = new Date(rows.at(-1)[0]);
    last.setUTCMonth(last.getUTCMonth() - months);
    const from = months >= 999 ? '' : last.toISOString().slice(0, 10);
    const start = rows.findIndex((r) => r[0] >= from);
    const step = months > 36 ? 5 : months > 12 ? 2 : 1;
    const bench = new Map(data.benchmark?.prices || []);
    const out = [];
    let base = null;
    let bBase = null;
    for (let i = Math.max(0, start); i < rows.length; i++) {
      if ((i - start) % step !== 0 && i !== rows.length - 1) continue;
      const [d, close, adj] = rows[i];
      if (mode === 'compare') {
        const b = bench.get(d);
        if (base == null) base = adj;
        if (bBase == null && b != null) bBase = b;
        out.push({ date: d, stock: (adj / base) * 100, bench: b != null && bBase ? (b / bBase) * 100 : null });
      } else {
        out.push({ date: d, price: close, sma50: s50[i], sma200: s200[i] });
      }
    }
    return out;
  }, [data, range, mode]);

  const periodReturn = chart.length > 1
    ? mode === 'compare' ? chart.at(-1).stock / 100 - 1 : chart.at(-1).price / chart[0].price - 1
    : null;
  const series = mode === 'compare'
    ? [{ key: 'stock', name: symbol, color: c.s1 }, { key: 'bench', name: data.benchmark?.name || 'Index', color: c.s2 }]
    : [
      { key: 'price', name: 'Price', color: c.s1 },
      ...(showSma ? [{ key: 'sma50', name: '50-day avg', color: c.s2, width: 1.5 }, { key: 'sma200', name: '200-day avg', color: c.s7, width: 1.5 }] : []),
    ];
  const v = a.valuation;
  const t = a.risk?.technicals;
  const score = a.score;

  return (
    <div className="stack">
      <div className="grid g3">
        <Card className="span2" title="Price" sub={periodReturn != null ? `${fmtSignedPct(periodReturn)} over ${range === 'Max' ? 'the full history' : range}` : ''}
          right={(
            <div className="row">
              <Seg options={[['price', 'Price'], ['compare', `vs ${data.benchmark?.name || 'index'}`]]} value={mode} onChange={setMode} />
              <Seg options={RANGES.map((r) => r[0])} value={range} onChange={setRange} />
            </div>
          )}>
          <LinesChart
            data={chart}
            series={series}
            area={mode === 'price'}
            height={300}
            yFmt={mode === 'compare' ? (x) => fmtNum(x, 0) : (x) => fmtPrice(x, currency).replace(/\.00$/, '')}
            xFmt={(d) => fmtDate(d).replace(/^\d+ /, '')}
            tooltipLabel={(d) => fmtDate(d)}
          />
          {mode === 'price' && (
            <label className="small text2 row" style={{ gap: 6, marginTop: 8 }}>
              <input type="checkbox" checked={showSma} onChange={(e) => setShowSma(e.target.checked)} /> Show 50/200-day moving averages
            </label>
          )}
          {mode === 'compare' && <div className="small muted" style={{ marginTop: 8 }}>Both indexed to 100 at the start of the period; dividends reinvested.</div>}
        </Card>

        <Card title="Scorecard" sub="0–100, higher is better">
          <Meter label="Growth" value={score.growth} title="Revenue and EPS growth (3y)" />
          <Meter label="Profitability" value={score.profitability} title="ROE, ROIC, operating margin" />
          <Meter label="Health" value={score.health} title="Piotroski, Altman, interest cover, red flags" />
          <Meter label="Value" value={score.value} title="DCF upside, P/E vs own history, Monte Carlo odds" />
          <Meter label="Momentum" value={score.momentum} title="1-year return vs index, 200-day trend" />
          <hr />
          <dl className="kv">
            <dt>Base-case fair value</dt><dd>{fmtPrice(v?.fair.base, currency)}</dd>
            <dt>Upside</dt><dd className={v?.upside > 0 ? 'up' : 'down'}>{fmtSignedPct(v?.upside, 0)}</dd>
            <dt>Growth priced in</dt><dd>{fmtPct(v?.reverse?.impliedGrowth)} / yr</dd>
            {a.thesis && (<><dt>Thesis</dt><dd><ThesisStatus status={a.thesis.status} short /></dd></>)}
          </dl>
          <a className="small" href={stockHref(symbol, 'valuation')}>Open valuation lab →</a>
        </Card>
      </div>

      <div className="tiles">
        <Tile label="Market cap" value={fmtMoney(quote.marketCap, currency)} note={`EV ${fmtMoney(quote.enterpriseValue, currency)}`} />
        <Tile label="P/E (ttm)" value={fmtNum(quote.trailingPE, 1)} note={`Forward ${fmtNum(quote.forwardPE, 1)}`} />
        <Tile label="EV / EBITDA" value={fmtNum(quote.evToEbitda, 1)} note={`P/S ${fmtNum(quote.priceToSales, 1)}`} />
        <Tile label="P/B" value={fmtNum(quote.priceToBook, 1)} note={`PEG ${fmtNum(quote.pegRatio, 2)}`} />
        <Tile label="Dividend yield" value={fmtPct(quote.dividendYield, 2)} note={`Payout ${fmtPct(quote.payoutRatio, 0)}`} />
        <Tile label="Beta" value={fmtNum(a.risk?.beta, 2)} note={`vs ${data.benchmark?.name || 'index'}, 3y`} />
        <Tile label="52-week range" value={`${fmtPrice(t?.low52, currency)} – ${fmtPrice(t?.high52, currency)}`} note={`${fmtSignedPct(t?.fromHigh)} from high`} />
        <Tile label="Analyst target" value={fmtPrice(quote.targetMean, currency)} note={quote.analystCount ? `${quote.analystCount} analysts · ${quote.recommendation?.replace('_', ' ')}` : 'No coverage'} />
        <Tile label="ROE" value={fmtPct(a.latest.roe)} note={a.isFinancial ? 'Latest fiscal year' : `ROIC ${fmtPct(a.latest.roic)}`} />
        <Tile label="Net debt / EBITDA" value={a.isFinancial ? 'n/a' : fmtX(a.latest.netDebtToEbitda)} note={a.isFinancial ? 'Bank: not meaningful' : `D/E ${fmtX(a.latest.debtToEquity, 2)}`} />
      </div>

      <div className="grid g3">
        <Card title="Forensic snapshot" right={<a className="small" href={stockHref(symbol, 'quality')}>Details →</a>}>
          <dl className="kv" style={{ marginBottom: 10 }}>
            <dt>Piotroski F-score</dt><dd>{a.piotroski ? `${a.piotroski.score}/${a.piotroski.max} · ${a.piotroski.verdict}` : '—'}</dd>
            <dt>Altman Z</dt><dd>{a.altman ? `${fmtNum(a.altman.z, 2)} · ${a.altman.zone}` : 'n/a'}</dd>
            <dt>Beneish M</dt><dd>{a.beneish ? `${fmtNum(a.beneish.m, 2)} · ${a.beneish.zone}` : 'n/a'}</dd>
          </dl>
          <div className="list">
            {a.redFlags.flags.slice(0, 4).map((f) => (
              <div key={f.title} className="list-item"><Severity level={f.severity} label={f.title} /></div>
            ))}
            {a.redFlags.strengths.slice(0, Math.max(0, 4 - a.redFlags.flags.length)).map((s) => (
              <div key={s.title} className="list-item"><Severity level="good" label={s.title} /></div>
            ))}
            {!a.redFlags.flags.length && !a.redFlags.strengths.length && <div className="muted">Nothing notable detected.</div>}
          </div>
        </Card>

        <Card title="About" sub={[profile.city, profile.country].filter(Boolean).join(', ')}>
          <p className={`text2 ${expanded ? '' : 'clamp'}`} style={{ marginBottom: 6 }}>{profile.summary || 'No description available.'}</p>
          {profile.summary && profile.summary.length > 300 && (
            <button className="icon-btn small" onClick={() => setExpanded((x) => !x)}>{expanded ? 'Show less' : 'Read more'}</button>
          )}
          <dl className="kv" style={{ marginTop: 10 }}>
            {profile.employees != null && (<><dt>Employees</dt><dd>{fmtNum(profile.employees, 0)}</dd></>)}
            {profile.website && (<><dt>Website</dt><dd><a href={profile.website} target="_blank" rel="noreferrer">{profile.website.replace(/^https?:\/\/(www\.)?/, '')}</a></dd></>)}
            {quote.nextEarnings && (<><dt>Next earnings</dt><dd>{fmtDate(quote.nextEarnings)}</dd></>)}
          </dl>
          {profile.officers?.length > 0 && (
            <>
              <hr />
              <div className="small">
                {profile.officers.slice(0, 4).map((o) => (
                  <div key={o.name} className="row" style={{ justifyContent: 'space-between', padding: '2px 0' }}>
                    <span>{o.name}</span><span className="muted" style={{ textAlign: 'right' }}>{o.title}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card title="Recent news">
          <div className="list">
            {data.news?.length ? data.news.slice(0, 7).map((n) => (
              <a key={n.link} className="list-item" href={n.link} target="_blank" rel="noreferrer" style={{ color: 'var(--text)' }}>
                <div>{n.title}</div>
                <div className="small muted">{n.publisher} · {fmtDate(n.time)}</div>
              </a>
            )) : <div className="muted">No recent headlines.</div>}
          </div>
        </Card>
      </div>

      {data.filings?.length > 0 && (
        <Card title="SEC filings" sub="Primary sources — every annual figure in Financials links to one of these">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Form</th><th>Filed</th><th>Period</th><th>Description</th><th>Links</th></tr></thead>
              <tbody>
                {data.filings.slice(0, 12).map((f) => (
                  <tr key={f.url}>
                    <td><b>{f.form}</b></td>
                    <td>{f.filed}</td>
                    <td>{f.period || '—'}</td>
                    <td className="lbl" style={{ textAlign: 'left', whiteSpace: 'normal' }}>{f.description || (f.items ? `Items ${f.items}` : '')}</td>
                    <td><a href={f.url} target="_blank" rel="noreferrer">Document</a> · <a href={f.index} target="_blank" rel="noreferrer">Index</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
