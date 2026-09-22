import { fmtPct, fmtNum, fmtPrice, fmtDate, fmtSignedPct, fmtCount } from '../../../core/format.js';
import { Card, Tile, SignedPct, Severity, Empty } from '../components/ui.jsx';
import { ColumnsChart, LinesChart } from '../components/charts.jsx';

export default function Risk({ data, a, symbol }) {
  const r = a.risk;
  if (!r) return <Empty>Not enough price history.</Empty>;
  const bench = data.benchmark?.name || 'Index';
  const t = r.technicals;
  const cur = data.currency;

  return (
    <div className="stack">
      <div className="tiles">
        <Tile label="Beta (3y)" value={fmtNum(r.beta, 2)} note={`Correlation ${fmtNum(r.correlation, 2)} with ${bench}`} />
        <Tile label="Volatility" value={fmtPct(r.vol1y)} note={`1y annualised · 3y ${fmtPct(r.vol3y)}`} />
        <Tile label="Max drawdown" value={fmtPct(r.maxDrawdown.dd)} note={r.maxDrawdown.peak ? `${fmtDate(r.maxDrawdown.peak)} → ${fmtDate(r.maxDrawdown.trough)}` : ''} />
        <Tile label="Current drawdown" value={fmtPct(r.currentDrawdown)} note="From all-time high in range" />
        <Tile label="1-day VaR (95%)" value={fmtPct(r.var95, 2)} note={`Avg loss beyond it ${fmtPct(r.cvar95, 2)}`} />
        <Tile label="Sharpe (3y)" value={fmtNum(r.sharpe3y, 2)} note={`Sortino ${fmtNum(r.sortino3y, 2)}`} />
        <Tile label="Up / down capture" value={`${fmtPct(r.upCapture, 0)} / ${fmtPct(r.downCapture, 0)}`} note={`Of ${bench}'s daily moves (3y)`} />
      </div>

      <div className="grid g2">
        <Card title="Trailing returns" sub="Periods over 1 year are annualised; dividends reinvested">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Period</th><th>{symbol}</th><th>{bench}</th><th>Difference</th></tr></thead>
              <tbody>
                {r.trailing.map((x) => (
                  <tr key={x.label}>
                    <td>{x.label}{x.annualized ? ' (ann.)' : ''}</td>
                    <td><SignedPct v={x.stock} /></td>
                    <td><SignedPct v={x.benchmark} /></td>
                    <td>{x.stock != null && x.benchmark != null ? <SignedPct v={x.stock - x.benchmark} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Calendar-year returns">
          <ColumnsChart data={r.yearly.map((y) => ({ label: y.year.replace(' YTD', '*'), stock: y.stock, benchmark: y.benchmark }))}
            series={[{ key: 'stock', name: symbol }, { key: 'benchmark', name: bench }]} yFmt={(v) => fmtPct(v, 0)} height={250} />
          <div className="small muted">* year to date</div>
        </Card>
      </div>

      <div className="grid g3">
        <Card className="span2" title="Drawdown from previous peak" sub="How far below its high the stock has traded">
          <LinesChart data={r.drawdownSeries.map(([date, dd]) => ({ date, dd }))} series={[{ key: 'dd', name: 'Drawdown' }]} area
            yFmt={(v) => fmtPct(v, 0)} xFmt={(d) => d.slice(0, 4)} tooltipLabel={(d) => fmtDate(d)} height={240} yDomain={['auto', 0]} />
        </Card>
        <Card title="Technical snapshot">
          <div className="list">
            <div className="list-item row" style={{ justifyContent: 'space-between' }}>
              <Severity level={t.aboveSma50 ? 'good' : 'warning'} label={t.aboveSma50 ? 'Above 50-day average' : 'Below 50-day average'} />
              <span className="num text2">{fmtPrice(t.sma50, cur)}</span>
            </div>
            <div className="list-item row" style={{ justifyContent: 'space-between' }}>
              <Severity level={t.aboveSma200 ? 'good' : 'warning'} label={t.aboveSma200 ? 'Above 200-day average' : 'Below 200-day average'} />
              <span className="num text2">{fmtPrice(t.sma200, cur)}</span>
            </div>
            <div className="list-item row" style={{ justifyContent: 'space-between' }}>
              <span>{t.goldenCross ? '50-day above 200-day (uptrend)' : '50-day below 200-day (downtrend)'}</span>
            </div>
            <div className="list-item row" style={{ justifyContent: 'space-between' }}>
              <span>RSI (14)</span>
              <span className="num"><b>{fmtNum(t.rsi14, 0)}</b> <span className="muted small">{t.rsi14 > 70 ? 'overbought' : t.rsi14 < 30 ? 'oversold' : 'neutral'}</span></span>
            </div>
            <div className="list-item row" style={{ justifyContent: 'space-between' }}>
              <span>From 52-week high / low</span>
              <span className="num">{fmtSignedPct(t.fromHigh)} / {fmtSignedPct(t.fromLow)}</span>
            </div>
            <div className="list-item row" style={{ justifyContent: 'space-between' }}>
              <span>Avg volume (50d)</span><span className="num">{fmtCount(t.avgVolume50)}</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
