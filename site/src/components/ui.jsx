import { fmtSignedPct } from '../../../core/format.js';

export function Card({ title, sub, right, children, className = '', style }) {
  return (
    <section className={`card ${className}`} style={style}>
      {(title || right) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Tile({ label, value, note, title }) {
  return (
    <div className="tile" title={title}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note != null && note !== '' && <div className="note">{note}</div>}
    </div>
  );
}

export function Delta({ v, digits = 2, suffix = '' }) {
  if (v == null || !Number.isFinite(v)) return <span className="muted">—</span>;
  const cls = v > 0 ? 'up' : v < 0 ? 'down' : '';
  return (
    <span className={`delta ${cls}`}>
      {v > 0 ? '▲ ' : v < 0 ? '▼ ' : ''}{fmtSignedPct(v, digits).replace(/^[+−]/, '')}{suffix}
    </span>
  );
}

// Signed, coloured percentage for tables (arrow carries direction, not colour alone).
export function SignedPct({ v, digits = 1 }) {
  if (v == null || !Number.isFinite(v)) return <span className="muted">—</span>;
  return <span className={v > 0 ? 'up' : v < 0 ? 'down' : ''}>{fmtSignedPct(v, digits)}</span>;
}

const SEV = {
  critical: { color: 'var(--critical)', label: 'Critical', icon: 'octagon' },
  serious: { color: 'var(--serious)', label: 'Serious', icon: 'triangle' },
  warning: { color: 'var(--warning)', label: 'Warning', icon: 'circle' },
  good: { color: 'var(--good)', label: 'Strength', icon: 'check' },
  unknown: { color: 'var(--muted)', label: 'Unknown', icon: 'dash' },
};

export function SevIcon({ level, size = 16 }) {
  const s = SEV[level] || SEV.unknown;
  const c = s.color;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {s.icon === 'octagon' && <path d="M5 1h6l4 4v6l-4 4H5l-4-4V5z" fill={c} />}
      {s.icon === 'triangle' && <path d="M8 1.5l7 13H1z" fill={c} />}
      {s.icon === 'circle' && <circle cx="8" cy="8" r="7" fill={c} />}
      {s.icon === 'check' && <circle cx="8" cy="8" r="7" fill={c} />}
      {s.icon === 'dash' && <circle cx="8" cy="8" r="7" fill={c} />}
      {s.icon === 'check' ? (
        <path d="M4.5 8.2l2.3 2.3 4.7-4.9" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ) : s.icon === 'dash' ? (
        <path d="M5 8h6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <>
          <path d={s.icon === 'triangle' ? 'M8 6v3.6' : 'M8 4.6v4'} stroke={level === 'warning' ? '#0b0b0b' : '#fff'} strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="8" cy={s.icon === 'triangle' ? 12 : 11.3} r="1" fill={level === 'warning' ? '#0b0b0b' : '#fff'} />
        </>
      )}
    </svg>
  );
}

export function Severity({ level, label }) {
  return (
    <span className="sev">
      <SevIcon level={level} />
      {label ?? SEV[level]?.label}
    </span>
  );
}

const THESIS = {
  intact: { level: 'good', label: 'Thesis intact' },
  'at-risk': { level: 'warning', label: 'Thesis at risk' },
  broken: { level: 'critical', label: 'Thesis broken' },
  unknown: { level: 'unknown', label: 'Not enough data' },
};
export function ThesisStatus({ status, short }) {
  if (!status) return <span className="muted">—</span>;
  const t = THESIS[status] || THESIS.unknown;
  return <Severity level={t.level} label={short ? t.label.replace('Thesis ', '') : t.label} />;
}

export function Seg({ options, value, onChange }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => {
        const [v, label] = Array.isArray(o) ? o : [o, o];
        return (
          <button key={v} className={value === v ? 'active' : ''} onClick={() => onChange(v)} role="tab" aria-selected={value === v}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function Meter({ label, value, title }) {
  return (
    <div className="meter" title={title}>
      <span className="text2">{label}</span>
      <div className="track"><div className="fill" style={{ width: `${value ?? 0}%` }} /></div>
      <span className="v">{value ?? '—'}</span>
    </div>
  );
}

export function Loading({ text = 'Loading…' }) {
  return (
    <div className="loading">
      <div className="spinner" />
      {text}
    </div>
  );
}

export function Legend({ items }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.name}>
          <i className={it.line ? 'line' : ''} style={{ background: it.color }} />
          {it.name}
        </span>
      ))}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="notice">{children}</div>;
}
