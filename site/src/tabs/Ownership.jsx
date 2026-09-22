import { fmtPct, fmtMoney, fmtNum, fmtCount, fmtDate } from '../../../core/format.js';
import { Card, Tile, SignedPct } from '../components/ui.jsx';
import { ColumnsChart } from '../components/charts.jsx';

export default function Ownership({ data }) {
  const h = data.holders || {};
  const e = data.estimates || {};
  const q = data.quote;
  const cur = data.currency;
  const rec = e.recommendations;
  const insiderLabel = data.market === 'IN' ? 'Promoters & insiders' : 'Insiders';
  const surprises = (e.earningsHistory || []).filter((x) => x.actual != null);

  return (
    <div className="stack">
      <div className="tiles">
        <Tile label={insiderLabel} value={fmtPct(h.insidersPct)} note={data.market === 'IN' ? 'Yahoo reports promoter stake here' : ''} />
        <Tile label="Institutions" value={fmtPct(h.institutionsPct)} note={h.institutionsCount ? `${fmtNum(h.institutionsCount, 0)} holders` : ''} />
        <Tile label="Analyst consensus" value={q.recommendation ? q.recommendation.replace('_', ' ') : '—'} note={q.analystCount ? `${q.analystCount} analysts` : 'No coverage'} />
        <Tile label="Mean target" value={fmtMoney(q.targetMean, cur)} note={q.targetLow ? `Range ${fmtMoney(q.targetLow, cur)} – ${fmtMoney(q.targetHigh, cur)}` : ''} />
      </div>

      <div className="grid g2">
        <Card title="Earnings vs. estimates" sub="Last four reported quarters (EPS)">
          {surprises.length ? (
            <>
              <ColumnsChart data={surprises.map((s) => ({ label: s.quarter?.slice(0, 7) || '', estimate: s.estimate, actual: s.actual }))}
                series={[{ key: 'estimate', name: 'Estimate' }, { key: 'actual', name: 'Actual' }]} yFmt={(v) => fmtNum(v, 2)} height={200} />
              <div className="row small text2" style={{ gap: 14 }}>
                {surprises.map((s) => <span key={s.quarter}>{s.quarter?.slice(0, 7)}: <SignedPct v={s.surprisePct} /></span>)}
              </div>
            </>
          ) : <div className="muted">No earnings history available.</div>}
        </Card>

        <Card title="Consensus estimates">
          {e.trend?.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Period</th><th>EPS est.</th><th>EPS growth</th><th>Revenue est.</th><th>Rev. growth</th><th>Analysts</th></tr></thead>
                <tbody>
                  {e.trend.filter((t) => ['0q', '+1q', '0y', '+1y'].includes(t.period)).map((t) => (
                    <tr key={t.period}>
                      <td>{{ '0q': 'This quarter', '+1q': 'Next quarter', '0y': 'This year', '+1y': 'Next year' }[t.period]}<div className="small muted">{t.endDate}</div></td>
                      <td>{fmtNum(t.epsAvg, 2)}</td>
                      <td><SignedPct v={t.growth} /></td>
                      <td>{fmtMoney(t.revenueAvg, cur)}</td>
                      <td><SignedPct v={t.revenueGrowth} /></td>
                      <td>{t.analysts ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="muted">No consensus estimates available.</div>}
          {rec && (
            <div className="small text2" style={{ marginTop: 10 }}>
              Ratings: {rec.strongBuy} strong buy · {rec.buy} buy · {rec.hold} hold · {rec.sell} sell · {rec.strongSell} strong sell
            </div>
          )}
        </Card>
      </div>

      <div className="grid g2">
        <Card title="Top institutional holders">
          {h.topInstitutions?.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Holder</th><th>Stake</th><th>Value</th><th>Change</th><th>As of</th></tr></thead>
                <tbody>
                  {h.topInstitutions.map((i) => (
                    <tr key={i.name}>
                      <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.name}</td>
                      <td>{fmtPct(i.pct, 2)}</td>
                      <td>{fmtMoney(i.value, cur)}</td>
                      <td><SignedPct v={i.change} /></td>
                      <td className="muted">{i.date || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="muted">Not reported.</div>}
        </Card>

        <Card title="Insider transactions">
          {h.insiderTransactions?.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Insider</th><th>Transaction</th><th>Shares</th><th>Value</th></tr></thead>
                <tbody>
                  {h.insiderTransactions.slice(0, 15).map((t, i) => (
                    <tr key={i}>
                      <td>{t.date}</td>
                      <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }} title={t.relation}>{t.name}</td>
                      <td className="lbl" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={t.text}>{t.text || '—'}</td>
                      <td>{fmtCount(t.shares)}</td>
                      <td>{fmtMoney(t.value, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="muted">None reported.</div>}
        </Card>
      </div>

      {e.rating?.length > 0 && (
        <Card title="Recent rating changes">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Firm</th><th>Action</th><th>From</th><th>To</th></tr></thead>
              <tbody>
                {e.rating.map((r, i) => (
                  <tr key={i}><td>{fmtDate(r.date)}</td><td>{r.firm}</td><td>{r.action}</td><td className="muted">{r.from || '—'}</td><td>{r.to}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {data.dividends?.length > 0 && (
        <Card title="Dividends & corporate actions" sub={`${data.dividends.length} dividends in 10 years`}>
          <ColumnsChart data={aggregateDividends(data.dividends)} series={[{ key: 'amount', name: 'Dividends per share' }]} yFmt={(v) => fmtNum(v, 2)} height={180} />
          {data.splits?.length > 0 && <div className="small text2">Splits / bonus issues: {data.splits.map(([d, r]) => `${d} (${r})`).join(', ')}</div>}
        </Card>
      )}
    </div>
  );
}

function aggregateDividends(divs) {
  const byYear = {};
  for (const [d, amt] of divs) byYear[d.slice(0, 4)] = (byYear[d.slice(0, 4)] || 0) + amt;
  return Object.entries(byYear).map(([label, amount]) => ({ label, amount }));
}
