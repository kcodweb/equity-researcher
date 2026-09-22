import { useMemo, useState } from 'react';
import { FIELDS, STATEMENTS, DERIVED_LABELS } from '../../../core/fields.js';
import { computeRatios } from '../../../core/analysis/ratios.js';
import { filingUrl } from '../../../core/sources/sec.js';
import { fmtMoney, fmtPct, fmtNum, fmtCount } from '../../../core/format.js';
import { Card, Seg, Empty } from '../components/ui.jsx';
import { ColumnsChart, LinesChart } from '../components/charts.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const periodLabel = (p, freq) => (freq === 'annual' ? `FY${p.fy}` : `${MONTHS[Number(p.period.slice(5, 7)) - 1]} ${p.period.slice(0, 4)}`);

export default function Financials({ data, a }) {
  const [freq, setFreq] = useState('annual');
  const [stmt, setStmt] = useState('income');
  const periods = freq === 'annual' ? data.annual : data.quarterly;
  const ratios = useMemo(() => (freq === 'annual' ? a.ratios : computeRatios(data.quarterly, { taxRate: data.assumptions.taxRate })), [freq, a, data]);
  const cur = data.currency;
  const m = (v) => fmtMoney(v, cur);

  if (!periods.length) return <Empty>No {freq} financial statements available for this company.</Empty>;

  const chartData = periods.map((p, i) => ({
    label: periodLabel(p, freq),
    revenue: p.revenue,
    netIncome: p.netIncome,
    fcf: p.fcf,
    cfo: p.cfo,
    grossMargin: ratios[i]?.grossMargin,
    operatingMargin: ratios[i]?.operatingMargin,
    netMargin: ratios[i]?.netMargin,
  }));
  const marginSeries = [
    ...(a.isFinancial ? [] : [{ key: 'grossMargin', name: 'Gross margin' }]),
    { key: 'operatingMargin', name: 'Operating margin' },
    { key: 'netMargin', name: 'Net margin' },
  ];

  const rows = STATEMENTS[stmt].filter((k) => periods.some((p) => p[k] != null));
  const fmtCell = (k, v) => {
    const unit = FIELDS[k]?.unit;
    if (unit === 'shares') return fmtCount(v);
    if (unit === 'USD/shares') return fmtNum(v, 2);
    return m(v);
  };

  const downloadCsv = () => {
    const all = [...STATEMENTS.income, ...STATEMENTS.balance, ...STATEMENTS.cashflow];
    const header = ['Metric', ...periods.map((p) => p.period)];
    const lines = [header, ...all.map((k) => [FIELDS[k]?.label || DERIVED_LABELS[k] || k, ...periods.map((p) => p[k] ?? '')])];
    const csv = lines.map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${data.symbol}-${freq}-financials.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const sources = freq === 'annual' ? data.sources : null;
  const g = a.growth;

  return (
    <div className="stack">
      <div className="row">
        <Seg options={[['annual', 'Annual'], ['quarterly', 'Quarterly']]} value={freq} onChange={setFreq} />
        <span className="small muted">
          {periods.length} {freq === 'annual' ? 'fiscal years' : 'quarters'} · {freq === 'annual' ? data.dataSource : 'Yahoo Finance'} · values in {cur}
          {data.fxRate ? ` (reported in ${data.financialCurrency}, converted at ${data.fxRate.toFixed(2)})` : ''}
        </span>
        <div className="spacer" />
        <button className="btn small" onClick={downloadCsv}>Download CSV</button>
      </div>

      <div className="grid g3">
        <Card title="Revenue & net income">
          <ColumnsChart data={chartData} series={[{ key: 'revenue', name: 'Revenue' }, { key: 'netIncome', name: 'Net income' }]} yFmt={(v) => fmtMoney(v, cur, { digits: 0 })} height={230} />
        </Card>
        <Card title="Margins">
          <LinesChart data={chartData} xKey="label" series={marginSeries} yFmt={(v) => fmtPct(v, 0)} height={230} tooltipLabel={(l) => l} />
        </Card>
        <Card title="Cash generation" sub="Operating cash flow and free cash flow">
          <ColumnsChart data={chartData} series={[{ key: 'cfo', name: 'Operating cash flow' }, { key: 'fcf', name: 'Free cash flow' }]} yFmt={(v) => fmtMoney(v, cur, { digits: 0 })} height={230} />
        </Card>
      </div>

      <Card
        title={{ income: 'Income statement', balance: 'Balance sheet', cashflow: 'Cash flow statement' }[stmt]}
        sub={sources ? 'Dotted values link to the SEC filing they were taken from' : undefined}
        right={<Seg options={[['income', 'Income'], ['balance', 'Balance sheet'], ['cashflow', 'Cash flow']]} value={stmt} onChange={setStmt} />}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{cur}</th>
                {periods.map((p) => <th key={p.period} title={`Period ending ${p.period}`}>{periodLabel(p, freq)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((k) => (
                <tr key={k}>
                  <td className="lbl">{FIELDS[k]?.label || DERIVED_LABELS[k]}</td>
                  {periods.map((p) => {
                    const src = sources?.[p.period]?.[k];
                    const val = fmtCell(k, p[k]);
                    return (
                      <td key={p.period} className={src ? 'src' : ''}>
                        {src && data.cik ? (
                          <a href={filingUrl(data.cik, src.accn)} target="_blank" rel="noreferrer"
                            title={`${src.form} filed ${src.filed} · XBRL tag ${src.tag}${src.splitAdjusted ? ` · restated ×${src.splitAdjusted} for later splits` : ''}`}>
                            {val}
                          </a>
                        ) : val}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {freq === 'annual' && (
        <Card title="Compound annual growth" sub={`Based on ${g.years} years of annual data`}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Metric</th><th>3 years</th><th>5 years</th><th>10 years</th><th>Full history</th></tr></thead>
              <tbody>
                {[['revenue', 'Revenue'], ['netIncome', 'Net income'], ['eps', 'EPS'], ['fcf', 'Free cash flow'], ['bookValuePerShare', 'Book value / share'], ['dividends', 'Dividends paid']].map(([k, label]) => (
                  <tr key={k}>
                    <td className="lbl">{label}</td>
                    {['3y', '5y', '10y', 'full'].map((y) => <td key={y}>{fmtPct(g[k]?.[y])}</td>)}
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
