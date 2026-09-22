import { RATIO_DEFS } from '../../../core/analysis/ratios.js';
import { fmtBy, fmtNum, fmtPct, fmtX } from '../../../core/format.js';
import { Card, Severity, Empty } from '../components/ui.jsx';
import { LinesChart } from '../components/charts.jsx';
import { useColors } from '../lib/theme.js';

const BENEISH_INFO = {
  DSRI: ['Days sales in receivables index', '> 1.46 is typical of manipulators'],
  GMI: ['Gross margin index', '> 1.19 means margins deteriorated'],
  AQI: ['Asset quality index', '> 1.25 means more costs capitalised'],
  SGI: ['Sales growth index', 'High growth creates pressure to manage earnings'],
  DEPI: ['Depreciation index', '> 1 means depreciation slowed'],
  SGAI: ['SG&A index', 'Rising overhead relative to sales'],
  LVGI: ['Leverage index', '> 1 means leverage increased'],
  TATA: ['Total accruals to total assets', '> 0.03 means earnings run ahead of cash'],
};

export default function Quality({ data, a }) {
  const c = useColors();
  const cur = data.currency;
  const years = a.ratios.slice(-10);
  const p = a.piotroski;

  const altmanSeries = a.altmanHistory.map((z) => ({ date: `FY${z.period.slice(0, 4)}`, z: z.z }));
  const returnsSeries = a.ratios.map((r) => ({ date: `FY${r.fy}`, roe: r.roe, roic: r.roic }));
  const holding = (data.holdingHistory || []).filter((h) => h.insidersPct != null);

  return (
    <div className="stack">
      <div className="grid g3">
        <Card title="Piotroski F-score" sub={p ? `FY${p.period.slice(0, 4)} vs prior year` : ''}>
          {p ? (
            <>
              <div className="row" style={{ alignItems: 'baseline', marginBottom: 8 }}>
                <span style={{ fontSize: 32, fontWeight: 650 }}>{p.score}</span>
                <span className="text2">/ {p.max} · {p.verdict}</span>
              </div>
              <div className="list">
                {p.tests.map((t) => (
                  <div key={t.key} className="list-item row" style={{ padding: '6px 0', justifyContent: 'space-between' }}>
                    <Severity level={t.pass == null ? 'unknown' : t.pass ? 'good' : 'critical'} label={t.label} />
                    <span className="small muted num">{t.value == null ? 'n/a' : fmtBy(t.fmt, t.value, cur)}</span>
                  </div>
                ))}
              </div>
              {a.piotroskiHistory.length > 1 && (
                <div className="small muted" style={{ marginTop: 8 }}>
                  History: {a.piotroskiHistory.slice(-8).map((h) => `${h.period.slice(2, 4)}:${h.score}`).join('  ')}
                </div>
              )}
            </>
          ) : <div className="muted">Needs two years of data.</div>}
        </Card>

        <Card title="Altman Z-score" sub="Bankruptcy risk">
          {a.isFinancial ? <div className="muted">Not meaningful for banks and insurers — their balance sheets are built on leverage.</div> : a.altman ? (
            <>
              <div className="row" style={{ alignItems: 'baseline', marginBottom: 4 }}>
                <span style={{ fontSize: 32, fontWeight: 650 }}>{fmtNum(a.altman.z, 2)}</span>
                <Severity level={a.altman.zone === 'Safe' ? 'good' : a.altman.zone === 'Grey' ? 'warning' : 'critical'} label={`${a.altman.zone} zone`} />
              </div>
              {altmanSeries.length > 1 && (
                <LinesChart data={altmanSeries} series={[{ key: 'z', name: 'Z-score', color: c.s1 }]} yFmt={(v) => fmtNum(v, 1)} height={150}
                  refLines={[{ y: 1.81, label: 'Distress 1.81', dash: true }, { y: 2.99, label: 'Safe 2.99', dash: true }]} tooltipLabel={(l) => l} />
              )}
              <dl className="kv small" style={{ marginTop: 8 }}>
                <dt>Working capital / assets ×1.2</dt><dd>{fmtNum(a.altman.parts.A, 3)}</dd>
                <dt>Retained earnings / assets ×1.4</dt><dd>{fmtNum(a.altman.parts.B, 3)}</dd>
                <dt>EBIT / assets ×3.3</dt><dd>{fmtNum(a.altman.parts.C, 3)}</dd>
                <dt>Market cap / liabilities ×0.6</dt><dd>{fmtNum(a.altman.parts.D, 3)}</dd>
                <dt>Sales / assets ×1.0</dt><dd>{fmtNum(a.altman.parts.E, 3)}</dd>
              </dl>
            </>
          ) : <div className="muted">Insufficient balance-sheet data.</div>}
        </Card>

        <Card title="Beneish M-score" sub="Earnings manipulation screen">
          {a.isFinancial ? <div className="muted">Not designed for financial companies.</div> : a.beneish ? (
            <>
              <div className="row" style={{ alignItems: 'baseline', marginBottom: 8 }}>
                <span style={{ fontSize: 32, fontWeight: 650 }}>{fmtNum(a.beneish.m, 2)}</span>
                <Severity level={a.beneish.zone === 'Unlikely' ? 'good' : a.beneish.zone === 'Watch' ? 'warning' : 'serious'} label={a.beneish.zone} />
              </div>
              <div className="small muted" style={{ marginBottom: 6 }}>Above −1.78 flags likely manipulation; −2.22 to −1.78 is a watch zone.</div>
              <table className="small">
                <tbody>
                  {Object.entries(a.beneish.components).map(([k, v]) => (
                    <tr key={k} title={BENEISH_INFO[k][1]}>
                      <td className="lbl">{BENEISH_INFO[k][0]}</td>
                      <td>{v == null ? 'n/a' : fmtNum(v, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : <div className="muted">Needs two years of detailed statements.</div>}
        </Card>
      </div>

      <div className="grid g2">
        <Card title="Red flags" sub={`${a.redFlags.flags.length} detected`}>
          {a.redFlags.flags.length ? (
            <div className="list">
              {a.redFlags.flags.map((f) => (
                <div key={f.title} className="list-item">
                  <Severity level={f.severity} label={f.title} />
                  <div className="text2 small" style={{ marginTop: 3, paddingLeft: 22 }}>{f.detail}</div>
                </div>
              ))}
            </div>
          ) : <div className="muted">No red flags triggered by the forensic rules.</div>}
        </Card>
        <Card title="Strengths" sub={`${a.redFlags.strengths.length} detected`}>
          {a.redFlags.strengths.length ? (
            <div className="list">
              {a.redFlags.strengths.map((s) => (
                <div key={s.title} className="list-item">
                  <Severity level="good" label={s.title} />
                  <div className="text2 small" style={{ marginTop: 3, paddingLeft: 22 }}>{s.detail}</div>
                </div>
              ))}
            </div>
          ) : <div className="muted">No standout strengths detected.</div>}
        </Card>
      </div>

      <div className="grid g2">
        <Card title="Returns on capital">
          <LinesChart data={returnsSeries} series={a.isFinancial ? [{ key: 'roe', name: 'ROE' }] : [{ key: 'roe', name: 'ROE' }, { key: 'roic', name: 'ROIC' }]}
            yFmt={(v) => fmtPct(v, 0)} height={220} tooltipLabel={(l) => l} />
        </Card>
        <Card title="DuPont analysis" sub="ROE = net margin × asset turnover × equity multiplier">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Year</th><th>Net margin</th><th>Asset turnover</th><th>Equity multiplier</th><th>ROE</th></tr></thead>
              <tbody>
                {a.dupont.slice(-6).map((d) => (
                  <tr key={d.period}>
                    <td>FY{d.period.slice(0, 4)}</td>
                    <td>{fmtPct(d.netMargin)}</td>
                    <td>{fmtX(d.assetTurnover, 2)}</td>
                    <td>{fmtX(d.equityMultiplier, 2)}</td>
                    <td><b>{fmtPct(d.roe)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {holding.length > 1 && (
        <Card title={data.market === 'IN' ? 'Promoter / insider holding' : 'Insider holding'} sub="Tracked by the daily build since it started">
          <LinesChart data={holding.map((h) => ({ date: h.date, insiders: h.insidersPct, institutions: h.institutionsPct }))}
            series={[{ key: 'insiders', name: data.market === 'IN' ? 'Promoters / insiders' : 'Insiders' }, { key: 'institutions', name: 'Institutions' }]}
            yFmt={(v) => fmtPct(v, 1)} height={200} />
        </Card>
      )}

      <Card title="All ratios" sub="Fiscal years, oldest to newest">
        {years.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Ratio</th>{years.map((r) => <th key={r.period}>FY{r.fy}</th>)}</tr>
              </thead>
              <tbody>
                {groupDefs().map(([group, keys]) => (
                  <GroupRows key={group} group={group} keys={keys} years={years} cur={cur} />
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>No annual data.</Empty>}
      </Card>
    </div>
  );
}

function groupDefs() {
  const groups = {};
  for (const [k, d] of Object.entries(RATIO_DEFS)) (groups[d.group] ||= []).push(k);
  return Object.entries(groups);
}

function GroupRows({ group, keys, years, cur }) {
  const visible = keys.filter((k) => years.some((r) => r[k] != null));
  if (!visible.length) return null;
  return (
    <>
      <tr className="group"><td colSpan={years.length + 1}>{group}</td></tr>
      {visible.map((k) => (
        <tr key={k}>
          <td className="lbl">{RATIO_DEFS[k].label}</td>
          {years.map((r) => <td key={r.period}>{fmtBy(RATIO_DEFS[k].fmt, r[k], cur)}</td>)}
        </tr>
      ))}
    </>
  );
}
