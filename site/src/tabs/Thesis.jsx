import { useState } from 'react';
import { THESIS_METRICS, evaluateThesis } from '../../../core/analysis/thesis.js';
import { fmtBy, fmtDate } from '../../../core/format.js';
import { Card, Severity, ThesisStatus } from '../components/ui.jsx';
import { fileKey } from '../lib/store.js';

const OPS = ['>=', '>', '<=', '<'];
const blankKpi = () => ({ name: '', metric: 'operatingMargin', op: '>=', value: 0.2, years: 1 });

export default function Thesis({ data, a, symbol, localThesis, onThesisChange }) {
  const repo = data.thesis;
  const [draft, setDraft] = useState(() => clone(localThesis || repo || {
    thesis: '', conviction: 'medium', kpis: [blankKpi(), { ...blankKpi(), metric: 'revenueGrowth', op: '>', value: 0.05 }],
  }));
  const [copied, setCopied] = useState(false);
  const preview = evaluateThesis(draft, a, data);
  const active = a.thesis;

  const setKpi = (i, patch) => setDraft((d) => ({ ...d, kpis: d.kpis.map((k, j) => (j === i ? { ...k, ...patch } : k)) }));
  const yamlText = toYaml(draft);

  const copy = async () => {
    try { await navigator.clipboard.writeText(yamlText); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([yamlText], { type: 'text/yaml' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileKey(symbol)}.yml`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="stack">
      <Card title="Current thesis check"
        sub={localThesis ? 'Using your local draft (this browser only)' : repo ? `From theses/${fileKey(symbol)}.yml${repo.written ? ` · written ${fmtDate(repo.written)}` : ''}` : 'No thesis yet — write one below'}
        right={active && <ThesisStatus status={active.status} />}>
        {active ? (
          <>
            {(localThesis || repo)?.thesis && <p className="text2" style={{ whiteSpace: 'pre-wrap' }}>{(localThesis || repo).thesis}</p>}
            <KpiTable results={active.results} cur={data.currency} />
          </>
        ) : (
          <p className="text2" style={{ margin: 0 }}>
            Write down why you own (or would buy) this stock and the numbers that would prove you wrong.
            The daily build re-checks every KPI against the newest results, so a broken thesis surfaces on the watchlist the day the data changes.
          </p>
        )}
      </Card>

      <Card title="Thesis editor" sub="Preview updates live against today's data">
        <div className="stack" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="thesis-text">Thesis</label>
            <textarea id="thesis-text" rows={4} value={draft.thesis || ''} placeholder="What does the market misunderstand? What has to go right?"
              onChange={(e) => setDraft((d) => ({ ...d, thesis: e.target.value }))} />
          </div>
          <div className="field" style={{ maxWidth: 200 }}>
            <label htmlFor="conv">Conviction</label>
            <select id="conv" value={draft.conviction || 'medium'} onChange={(e) => setDraft((d) => ({ ...d, conviction: e.target.value }))}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
          </div>

          <div className="table-wrap">
            <table>
              <thead><tr><th>KPI description</th><th>Metric</th><th>Rule</th><th>Threshold</th><th title="Must hold in each of the last N years">Years</th><th>Now</th><th>Status</th><th /></tr></thead>
              <tbody>
                {draft.kpis.map((k, i) => {
                  const m = THESIS_METRICS[k.metric];
                  const isPct = m?.fmt === 'pct';
                  const r = preview?.results?.[i];
                  return (
                    <tr key={i}>
                      <td><input type="text" value={k.name || ''} placeholder="e.g. Margins hold" onChange={(e) => setKpi(i, { name: e.target.value })} style={{ width: 200 }} /></td>
                      <td>
                        <select value={k.metric} onChange={(e) => setKpi(i, { metric: e.target.value })} style={{ maxWidth: 230 }}>
                          {Object.entries(THESIS_METRICS).map(([key, def]) => <option key={key} value={key}>{def.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={k.op} onChange={(e) => setKpi(i, { op: e.target.value })}>
                          {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>
                      <td>
                        <input type="number" step="any" style={{ width: 90 }}
                          value={isPct ? round(Number(k.value) * 100) : k.value}
                          onChange={(e) => setKpi(i, { value: isPct ? Number(e.target.value) / 100 : Number(e.target.value) })} />
                        {isPct && <span className="muted"> %</span>}
                      </td>
                      <td><input type="number" min="1" max="10" style={{ width: 56 }} value={k.years || 1} disabled={!m?.series} onChange={(e) => setKpi(i, { years: Number(e.target.value) || 1 })} /></td>
                      <td>{r?.actual != null ? fmtBy(r.fmt, r.actual, data.currency) : '—'}</td>
                      <td>{r && <Severity level={r.status === 'ok' ? 'good' : r.status === 'broken' ? 'critical' : 'unknown'} label={r.status === 'ok' ? 'Holds' : r.status === 'broken' ? 'Broken' : 'No data'} />}</td>
                      <td><button className="icon-btn" aria-label="Remove KPI" onClick={() => setDraft((d) => ({ ...d, kpis: d.kpis.filter((_, j) => j !== i) }))}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button className="btn small" onClick={() => setDraft((d) => ({ ...d, kpis: [...d.kpis, blankKpi()] }))}>+ Add KPI</button>
            <span className="small text2">Preview: {preview ? <ThesisStatus status={preview.status} /> : '—'}</span>
          </div>
          <hr />
          <div className="row">
            <button className="btn primary" onClick={() => onThesisChange({ ...draft, written: draft.written || new Date().toISOString().slice(0, 10) })}>Save draft in this browser</button>
            {localThesis && <button className="btn" onClick={() => onThesisChange(null)}>Discard local draft</button>}
            <div className="spacer" />
            <button className="btn" onClick={copy}>{copied ? 'Copied ✓' : 'Copy YAML'}</button>
            <button className="btn" onClick={download}>Download .yml</button>
          </div>
          <div className="small muted">
            To have the daily build track it (and show status on the watchlist), commit the YAML as <code>theses/{fileKey(symbol)}.yml</code> in your repo — GitHub's web editor works fine.
          </div>
        </div>
      </Card>
    </div>
  );
}

function KpiTable({ results, cur }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>KPI</th><th>Rule</th><th>Actual</th><th>Status</th></tr></thead>
        <tbody>
          {results.map((r, i) => (
            <tr key={i}>
              <td style={{ whiteSpace: 'normal' }}>{r.name || r.label}<div className="small muted">{r.label}</div></td>
              <td className="num">{r.op} {fmtBy(r.fmt, Number(r.value), cur)}{r.years > 1 ? ` · each of last ${r.years}y` : ''}</td>
              <td>{r.actual != null ? fmtBy(r.fmt, r.actual, cur) : '—'}{r.history && r.years > 1 && <div className="small muted">{r.history.map((h) => fmtBy(r.fmt, h, cur)).join(' · ')}</div>}</td>
              <td><Severity level={r.status === 'ok' ? 'good' : r.status === 'broken' ? 'critical' : 'unknown'} label={r.status === 'ok' ? 'Holds' : r.status === 'broken' ? 'Broken' : 'No data'} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const clone = (x) => JSON.parse(JSON.stringify(x));
const round = (x) => Math.round(x * 1000) / 1000;
const q = (s) => JSON.stringify(String(s ?? ''));

function toYaml(t) {
  const lines = [
    '# Investment thesis — evaluated automatically by the daily build.',
    `written: ${t.written ? String(t.written).slice(0, 10) : new Date().toISOString().slice(0, 10)}`,
    `conviction: ${t.conviction || 'medium'}`,
    'thesis: |',
    ...String(t.thesis || '').split('\n').map((l) => `  ${l}`),
    '',
    'kpis:',
  ];
  for (const k of t.kpis || []) {
    lines.push(`  - name: ${q(k.name || THESIS_METRICS[k.metric]?.label)}`);
    lines.push(`    metric: ${k.metric}`);
    lines.push(`    op: ${q(k.op)}`);
    lines.push(`    value: ${Number(k.value)}`);
    if (Number(k.years) > 1) lines.push(`    years: ${Number(k.years)}`);
  }
  return `${lines.join('\n')}\n`;
}
