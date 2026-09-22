import { useMemo, useState } from 'react';
import { dcf, reverseDcf, sensitivity, monteCarlo, scenarios as makeScenarios, justifiedPB, ttmFcf } from '../../../core/analysis/valuation.js';
import { fmtMoney, fmtPrice, fmtPct, fmtNum, fmtSignedPct, fmtDate } from '../../../core/format.js';
import { mean } from '../../../core/util.js';
import { Card, Seg, Tile, Empty, Legend } from '../components/ui.jsx';
import { ColumnsChart, LinesChart } from '../components/charts.jsx';
import { useColors, mix, luminance } from '../lib/theme.js';

const MULTIPLES = [['pe', 'P/E'], ['evEbitda', 'EV/EBITDA'], ['ps', 'P/S'], ['pb', 'P/B'], ['pfcf', 'P/FCF']];

export default function Valuation({ data, a }) {
  const v = a.valuation;
  if (!v || !v.inputs) return <Empty>Not enough financial data to value this company.</Empty>;
  return <Lab key={data.generatedAt} data={data} a={a} v={v} />;
}

function Lab({ data, a, v }) {
  const c = useColors();
  const cur = data.currency;
  const price = data.quote.price;
  const last = data.annual.at(-1) || {};
  const fcfBase = ttmFcf(data) > 0 ? ttmFcf(data) : mean(data.annual.slice(-3).map((p) => p.fcf));
  const earningsBase = last.netIncome;

  const [scen, setScen] = useState(() => v.scenarios);
  const [active, setActive] = useState('base');
  const [multiple, setMultiple] = useState(a.isFinancial ? 'pb' : 'pe');
  const inp = scen[active];

  const update = (patch) => setScen((s) => ({ ...s, [active]: { ...s[active], ...patch } }));
  const setModel = (model) => {
    const base = model === 'fcf' ? fcfBase : earningsBase;
    setScen((s) => Object.fromEntries(Object.entries(s).map(([k, x]) => [k, { ...x, model, baseCashFlow: Math.round(base || 0) }])));
  };
  const reset = () => setScen(v.scenarios);
  const regenerate = () => setScen(makeScenarios(scen.base));

  const results = useMemo(() => Object.fromEntries(Object.entries(scen).map(([k, x]) => [k, dcf(x)])), [scen]);
  const res = results[active];
  const rev = useMemo(() => reverseDcf(inp, price), [inp, price]);
  const sens = useMemo(() => sensitivity(inp), [inp]);
  const mc = useMemo(() => monteCarlo(inp, { runs: 4000 }), [inp]);
  const ms = v.multiples?.stats?.[multiple];
  const eps = data.quote.trailingEps ?? a.latest.eps;
  const bvps = data.quote.bookValuePerShare ?? a.latest.bookValuePerShare;
  const jpb = justifiedPB({ roe: mean(a.ratios.slice(-3).map((r) => r.roe)), growth: inp.terminalGrowth, costOfEquity: inp.discountRate, bvps });
  const histGrowth = inp.model === 'earnings' ? a.growth.eps['5y'] ?? a.growth.eps.full : a.growth.revenue['5y'] ?? a.growth.revenue.full;
  const fwd = data.estimates?.trend?.find((t) => t.period === '+1y')?.growth;

  // Football field rows: [label, low, high, point?]
  const peStats = v.multiples?.stats?.pe;
  const field = [
    ['DCF bear → bull', results.bear?.perShare, results.bull?.perShare, results.base?.perShare],
    mc && ['Monte Carlo P10 → P90', mc.p10, mc.p90, mc.p50],
    peStats && eps > 0 && ['Own P/E history ±1σ', (peStats.mean - peStats.sd) * eps, (peStats.mean + peStats.sd) * eps, peStats.mean * eps],
    data.quote.targetLow && ['Analyst targets', data.quote.targetLow, data.quote.targetHigh, data.quote.targetMean],
    a.risk?.technicals && ['52-week range', a.risk.technicals.low52, a.risk.technicals.high52, null],
    v.graham && ['Graham number', v.graham, v.graham, v.graham],
    jpb && jpb.value > 0 && ['Justified P/B', jpb.value, jpb.value, jpb.value],
  ].filter((r) => r && Number.isFinite(r[1]) && Number.isFinite(r[2]));

  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const slider = (label, key, min, max, step, hint) => (
    <div className="field">
      <label htmlFor={key} className="row" style={{ justifyContent: 'space-between' }}>
        <span>{label}</span><b className="num" style={{ color: 'var(--text)' }}>{pct(inp[key])}</b>
      </label>
      <input id={key} type="range" min={min} max={max} step={step} value={inp[key]} onChange={(e) => update({ [key]: Number(e.target.value) })} />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );

  return (
    <div className="stack">
      <div className="grid g3">
        <Card title="Assumptions" sub="Edit any scenario — everything recalculates instantly"
          right={<Seg options={[['bear', 'Bear'], ['base', 'Base'], ['bull', 'Bull']]} value={active} onChange={setActive} />}>
          <div className="stack" style={{ gap: 14 }}>
            <div className="field">
              <label>Cash flow to value</label>
              <Seg options={[['fcf', 'Free cash flow'], ['earnings', 'Net income']]} value={inp.model} onChange={setModel} />
              <span className="hint">{a.isFinancial ? 'Banks: earnings-based (their cash flows are not meaningful).' : 'Use net income when free cash flow is distorted by a capex cycle.'}</span>
            </div>
            <div className="field">
              <label htmlFor="base">Starting {inp.model === 'fcf' ? 'free cash flow' : 'net income'} ({cur})</label>
              <input id="base" type="number" value={inp.baseCashFlow ?? ''} onChange={(e) => update({ baseCashFlow: Number(e.target.value) })} />
              <span className="hint">{fmtMoney(inp.baseCashFlow, cur)} · last FY FCF {fmtMoney(last.fcf, cur)} · net income {fmtMoney(last.netIncome, cur)}</span>
            </div>
            {slider(`Growth, years 1–${inp.highGrowthYears}`, 'growth', -0.2, 0.5, 0.0025, `History ${fmtPct(histGrowth)} · consensus next FY ${fmtPct(fwd)}`)}
            {slider('Discount rate', 'discountRate', 0.05, 0.2, 0.0025, `Risk-free ${fmtPct(data.assumptions.riskFree, 2)} + β ${fmtNum(v.inputs.beta, 2)} × ERP ${fmtPct(data.assumptions.equityRiskPremium)}`)}
            {slider('Terminal growth', 'terminalGrowth', 0, 0.08, 0.0025, 'Long-run nominal growth — should not exceed the economy')}
            <div className="row" style={{ gap: 10 }}>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="hy">High-growth years</label>
                <input id="hy" type="number" min="1" max="15" value={inp.highGrowthYears} onChange={(e) => update({ highGrowthYears: Math.max(1, Math.min(15, Number(e.target.value) || 1)) })} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="fy">Fade years</label>
                <input id="fy" type="number" min="0" max="15" value={inp.fadeYears} onChange={(e) => update({ fadeYears: Math.max(0, Math.min(15, Number(e.target.value) || 0)) })} />
              </div>
            </div>
            <div className="small text2">Net debt {fmtMoney(inp.netDebt, cur)} · {fmtNum(inp.shares / 1e6, 0)}M shares</div>
            <div className="row">
              <button className="btn small" onClick={regenerate} title="Rebuild bear and bull cases from the base case">Rebuild bear/bull from base</button>
              <button className="btn small" onClick={reset}>Reset all</button>
            </div>
          </div>
        </Card>

        <div className="span2 stack">
          <div className="tiles">
            {['bear', 'base', 'bull'].map((k) => (
              <Tile key={k} label={`${k[0].toUpperCase()}${k.slice(1)} case`} value={fmtPrice(results[k]?.perShare, cur)}
                note={results[k] ? `${fmtSignedPct(results[k].perShare / price - 1, 0)} vs ${fmtPrice(price, cur)}` : 'Discount rate must exceed terminal growth'} />
            ))}
            <Tile label="Growth priced in" value={rev ? `${rev.bound === 'above' ? '>' : rev.bound === 'below' ? '<' : ''}${fmtPct(rev.impliedGrowth)}` : '—'} note={`per year for ${inp.highGrowthYears} years (reverse DCF)`} />
          </div>

          <Card title="Valuation range" sub={`Per share, ${cur}. Dot = midpoint; the line marks today's price.`}>
            <FootballField rows={field} price={price} cur={cur} c={c} />
          </Card>

          <Card title="What the market is pricing in">
            {rev ? (
              <p className="text2" style={{ margin: 0 }}>
                At <b style={{ color: 'var(--text)' }}>{fmtPrice(price, cur)}</b>, with a {pct(inp.discountRate)} discount rate and {pct(inp.terminalGrowth)} terminal growth, the market is assuming
                {' '}<b style={{ color: 'var(--text)' }}>{fmtPct(rev.impliedGrowth)}</b> annual growth in {inp.model === 'fcf' ? 'free cash flow' : 'earnings'} for {inp.highGrowthYears} years.
                {' '}Over the last five years the company grew {inp.model === 'fcf' ? 'revenue' : 'EPS'} at <b style={{ color: 'var(--text)' }}>{fmtPct(histGrowth)}</b>
                {Number.isFinite(fwd) && <> and analysts expect <b style={{ color: 'var(--text)' }}>{fmtPct(fwd)}</b> next year</>}.
                {' '}{Number.isFinite(histGrowth) && (rev.impliedGrowth > histGrowth + 0.03 ? 'The price needs growth to accelerate beyond its track record.' : rev.impliedGrowth < histGrowth - 0.03 ? 'The price assumes a slowdown versus its track record — a margin of safety if history repeats.' : 'The price assumes roughly its historical pace continues.')}
              </p>
            ) : <div className="muted">Reverse DCF needs a positive starting cash flow.</div>}
          </Card>
        </div>
      </div>

      <div className="grid g2">
        <Card title="Sensitivity: discount rate × terminal growth" sub={`${active} case, value per share; blue above today's price, red below`}>
          <HeatGrid rowsLabel="Discount" colsLabel="Terminal g" rows={sens.rates} cols={sens.tgs} grid={sens.grid} price={price} cur={cur} c={c} baseRow={2} baseCol={2} />
        </Card>
        <Card title="Sensitivity: growth × discount rate" sub="Value per share">
          <HeatGrid rowsLabel="Growth" colsLabel="Discount" rows={sens.growthRows} cols={sens.rates} grid={sens.grid2} price={price} cur={cur} c={c} baseRow={2} baseCol={2} />
        </Card>
      </div>

      <div className="grid g2">
        <Card title="Monte Carlo simulation" sub={mc ? `${mc.runs.toLocaleString()} runs around the ${active} case` : ''}>
          {mc ? (
            <>
              <div className="row" style={{ gap: 18, marginBottom: 8 }}>
                <span><span className="muted small">P10</span> <b>{fmtPrice(mc.p10, cur)}</b></span>
                <span><span className="muted small">Median</span> <b>{fmtPrice(mc.p50, cur)}</b></span>
                <span><span className="muted small">P90</span> <b>{fmtPrice(mc.p90, cur)}</b></span>
                <span><span className="muted small">P(value &gt; price)</span> <b>{fmtPct(mc.probAbovePrice, 0)}</b></span>
              </div>
              <Legend items={[{ name: 'Outcomes above today\'s price', color: c.s1 }, { name: 'Below', color: c.neutralMark }]} />
              <ColumnsChart
                data={mc.hist.map((b) => ({ label: fmtPrice((b.x0 + b.x1) / 2, cur).replace(/\.\d+$/, ''), count: b.count, mid: (b.x0 + b.x1) / 2 }))}
                series={[{ key: 'count', name: 'Simulations' }]}
                colorFor={(d) => (d.mid >= price ? c.s1 : c.neutralMark)}
                yFmt={(x) => fmtNum(x, 0)} height={220}
              />
              <div className="small muted">σ: growth ±{pct(mc.params.growthSd)}, discount ±{pct(mc.params.rateSd)}, terminal ±{pct(mc.params.tgSd)}, starting cash flow ±{pct(mc.params.cfSd)}.</div>
            </>
          ) : <div className="muted">Needs a positive starting cash flow.</div>}
        </Card>

        <Card title="Valuation vs its own history" sub={v.multiples?.from ? `Month-end since ${fmtDate(v.multiples.from)}` : ''}
          right={<Seg options={MULTIPLES.filter(([k]) => v.multiples?.stats?.[k])} value={multiple} onChange={setMultiple} />}>
          {ms ? (
            <>
              <div className="row" style={{ gap: 18, marginBottom: 8 }}>
                <span><span className="muted small">Now</span> <b>{fmtNum(ms.current, 1)}×</b></span>
                <span><span className="muted small">Average</span> <b>{fmtNum(ms.mean, 1)}×</b></span>
                <span><span className="muted small">Percentile</span> <b>{fmtPct(ms.percentile, 0)}</b></span>
              </div>
              <LinesChart
                data={v.multiples.series.filter((s) => s[multiple] != null && s[multiple] < ms.max * 1.01)}
                series={[{ key: multiple, name: MULTIPLES.find((m) => m[0] === multiple)[1], color: c.s1 }]}
                yFmt={(x) => `${fmtNum(x, 1)}×`}
                xFmt={(d) => d.slice(0, 4)}
                tooltipLabel={(d) => fmtDate(d)}
                refLines={[
                  { y: ms.mean, label: 'Average', color: c.text2 },
                  { y: ms.mean + ms.sd, label: '+1σ', dash: true },
                  { y: Math.max(0, ms.mean - ms.sd), label: '−1σ', dash: true },
                ]}
                height={240}
              />
              {multiple === 'pe' && v.atMeanPE && <div className="small text2">Re-rating to its average P/E would put the stock at <b>{fmtPrice(v.atMeanPE, cur)}</b> on trailing EPS.</div>}
            </>
          ) : <div className="muted">Not enough history for this multiple.</div>}
        </Card>
      </div>

      {res && (
        <Card title={`Projection — ${active} case`}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Year</th>{res.flows.map((f) => <th key={f.year}>{f.year}</th>)}<th>Terminal</th></tr>
              </thead>
              <tbody>
                <tr><td className="lbl">Growth</td>{res.flows.map((f) => <td key={f.year}>{fmtPct(f.growth)}</td>)}<td>{fmtPct(inp.terminalGrowth)}</td></tr>
                <tr><td className="lbl">{inp.model === 'fcf' ? 'Free cash flow' : 'Net income'}</td>{res.flows.map((f) => <td key={f.year}>{fmtMoney(f.cashFlow, cur)}</td>)}<td>{fmtMoney(res.terminalValue, cur)}</td></tr>
                <tr><td className="lbl">Present value</td>{res.flows.map((f) => <td key={f.year}>{fmtMoney(f.pv, cur)}</td>)}<td>{fmtMoney(res.pvTerminal, cur)}</td></tr>
              </tbody>
            </table>
          </div>
          <dl className="kv" style={{ maxWidth: 420, marginTop: 12 }}>
            <dt>Enterprise value</dt><dd>{fmtMoney(res.enterpriseValue, cur)}</dd>
            <dt>− Net debt</dt><dd>{fmtMoney(inp.netDebt, cur)}</dd>
            <dt>Equity value</dt><dd>{fmtMoney(res.equityValue, cur)}</dd>
            <dt>Per share</dt><dd><b>{fmtPrice(res.perShare, cur)}</b></dd>
            <dt>Terminal value share of EV</dt><dd>{fmtPct(res.terminalShare, 0)}</dd>
          </dl>
        </Card>
      )}
    </div>
  );
}

function HeatGrid({ rowsLabel, colsLabel, rows, cols, grid, price, cur, c, baseRow, baseCol }) {
  const cellColor = (val) => {
    if (!Number.isFinite(val)) return { background: 'transparent' };
    const d = Math.max(-1, Math.min(1, val / price - 1));
    const bg = d >= 0 ? mix(c.divMid, c.divPos, Math.min(1, d / 0.6) * 0.85) : mix(c.divMid, c.divNeg, Math.min(1, -d / 0.6) * 0.85);
    return { background: bg, color: luminance(bg) < 0.3 ? '#fff' : '#0b0b0b' };
  };
  return (
    <div className="table-wrap">
      <table className="heat">
        <thead>
          <tr>
            <th>{rowsLabel} ↓ / {colsLabel} →</th>
            {cols.map((x) => <th key={x} style={{ textAlign: 'center' }}>{fmtPct(x, 1)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r}>
              <td><b>{fmtPct(r, 1)}</b></td>
              {grid[i].map((val, j) => (
                <td key={j} className={i === baseRow && j === baseCol ? 'base' : ''} style={cellColor(val)} title={Number.isFinite(val) ? `${fmtSignedPct(val / price - 1, 0)} vs price` : 'Invalid: discount ≤ growth'}>
                  {Number.isFinite(val) ? fmtPrice(val, cur).replace(/\.\d+$/, '') : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Classic banker's "football field": value ranges from each method against today's price.
function FootballField({ rows, price, cur, c }) {
  const [hover, setHover] = useState(null);
  if (!rows.length) return <div className="muted">No valuation ranges available.</div>;
  const vals = rows.flatMap((r) => [r[1], r[2]]).concat(price).filter(Number.isFinite);
  const lo = Math.min(...vals) * 0.9;
  const hi = Math.max(...vals) * 1.05;
  const W = 640; const labelW = 170; const rowH = 34; const top = 8; const H = top + rows.length * rowH + 24;
  const x = (v) => labelW + ((v - lo) / (hi - lo)) * (W - labelW - 16);
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Valuation ranges by method">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top} y2={H - 20} stroke={c.grid} />
            <text x={x(t)} y={H - 6} textAnchor="middle" fontSize="11" fill={c.muted}>{fmtPrice(t, cur).replace(/\.\d+$/, '')}</text>
          </g>
        ))}
        {rows.map(([label, a, b, mid], i) => {
          const y = top + i * rowH + rowH / 2;
          const x1 = x(Math.min(a, b));
          const x2 = x(Math.max(a, b));
          const point = x2 - x1 < 3;
          return (
            <g key={label} onMouseEnter={() => setHover({ i, label, a, b, mid })} onMouseLeave={() => setHover(null)} style={{ cursor: 'default' }}>
              <rect x={0} y={y - rowH / 2} width={W} height={rowH} fill="transparent" />
              <text x={0} y={y + 4} fontSize="12" fill={c.text2}>{label}</text>
              {point ? (
                <circle cx={x1} cy={y} r={6} fill={c.s1} stroke={c.surface} strokeWidth="2" />
              ) : (
                <rect x={x1} y={y - 7} width={Math.max(2, x2 - x1)} height={14} rx={4} fill={c.s1} fillOpacity={hover?.i === i ? 0.55 : 0.35} />
              )}
              {!point && Number.isFinite(mid) && <circle cx={x(mid)} cy={y} r={4.5} fill={c.s1} stroke={c.surface} strokeWidth="2" />}
            </g>
          );
        })}
        <line x1={x(price)} x2={x(price)} y1={top - 4} y2={H - 20} stroke={c.text} strokeWidth="1.5" />
        <text x={x(price)} y={top + 2} dx={4} fontSize="11" fill={c.text} fontWeight="600">Price {fmtPrice(price, cur)}</text>
      </svg>
      {hover && (
        <div className="tt" style={{ position: 'absolute', top: 8 + hover.i * 34 + 30, left: '40%', pointerEvents: 'none' }}>
          <div className="tt-title">{hover.label}</div>
          {hover.a !== hover.b && <div className="tt-row"><span className="k">Low</span><span className="v">{fmtPrice(Math.min(hover.a, hover.b), cur)}</span></div>}
          {Number.isFinite(hover.mid) && <div className="tt-row"><span className="k">Mid</span><span className="v">{fmtPrice(hover.mid, cur)}</span></div>}
          {hover.a !== hover.b && <div className="tt-row"><span className="k">High</span><span className="v">{fmtPrice(Math.max(hover.a, hover.b), cur)}</span></div>}
          {Number.isFinite(hover.mid) && <div className="tt-row"><span className="k">vs price</span><span className="v">{fmtSignedPct(hover.mid / price - 1, 0)}</span></div>}
        </div>
      )}
    </div>
  );
}
