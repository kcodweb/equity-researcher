import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ComposedChart, Area, Cell, ReferenceArea,
} from 'recharts';
import { useColors } from '../lib/theme.js';
import { Legend } from './ui.jsx';

const axisProps = (c) => ({
  stroke: c.axis,
  tick: { fill: c.muted, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: c.axis },
});

export function TooltipBox({ active, payload, label, labelFmt, fmt, rows }) {
  if (!active || !payload?.length) return null;
  const items = rows ? rows(payload) : payload.filter((p) => p.value != null);
  return (
    <div className="tt">
      <div className="tt-title">{labelFmt ? labelFmt(label, payload) : label}</div>
      {items.map((p) => (
        <div className="tt-row" key={p.dataKey || p.name}>
          <span className="k"><i style={{ background: p.color || p.stroke || p.fill }} />{p.name}</span>
          <span className="v">{fmt ? fmt(p.value, p) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

// Time series lines on one axis. series: [{ key, name, color?, width?, dash? }]
export function LinesChart({ data, xKey = 'date', series, yFmt = (v) => v, xFmt, height = 280, refLines = [], area = false, yDomain, tooltipLabel, bands = [] }) {
  const c = useColors();
  const colored = series.map((s, i) => ({ ...s, color: s.color || c.series[i] }));
  return (
    <div>
      {colored.length > 1 && <div style={{ marginBottom: 8 }}><Legend items={colored.map((s) => ({ name: s.name, color: s.color, line: true }))} /></div>}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey={xKey} {...axisProps(c)} tickFormatter={xFmt} minTickGap={40} />
          <YAxis {...axisProps(c)} tickFormatter={yFmt} width={64} domain={yDomain || ['auto', 'auto']} axisLine={false} />
          {bands.map((b, i) => <ReferenceArea key={i} y1={b.y1} y2={b.y2} fill={b.color} fillOpacity={0.08} stroke="none" />)}
          <Tooltip
            content={<TooltipBox fmt={(v) => yFmt(v)} labelFmt={tooltipLabel || xFmt} />}
            cursor={{ stroke: c.axis, strokeWidth: 1 }}
          />
          {refLines.map((r, i) => (
            <ReferenceLine key={i} y={r.y} stroke={r.color || c.muted} strokeDasharray={r.dash ? '4 4' : undefined} strokeWidth={1}
              label={r.label ? { value: r.label, position: r.position || 'insideTopRight', fill: c.text2, fontSize: 11 } : undefined} />
          ))}
          {area && colored[0] && (
            <Area type="monotone" dataKey={colored[0].key} stroke="none" fill={colored[0].color} fillOpacity={0.1} isAnimationActive={false} legendType="none" tooltipType="none" />
          )}
          {colored.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={s.width || 2}
              strokeDasharray={s.dash} dot={false} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} isAnimationActive={false} connectNulls />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// Grouped columns. series: [{ key, name, color? }]
export function ColumnsChart({ data, xKey = 'label', series, yFmt = (v) => v, height = 260, refLines = [], colorFor }) {
  const c = useColors();
  const colored = series.map((s, i) => ({ ...s, color: s.color || c.series[i] }));
  return (
    <div>
      {colored.length > 1 && <div style={{ marginBottom: 8 }}><Legend items={colored.map((s) => ({ name: s.name, color: s.color }))} /></div>}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey={xKey} {...axisProps(c)} />
          <YAxis {...axisProps(c)} tickFormatter={yFmt} width={64} axisLine={false} />
          <Tooltip content={<TooltipBox fmt={(v) => yFmt(v)} />} cursor={{ fill: c.grid, fillOpacity: 0.5 }} />
          <ReferenceLine y={0} stroke={c.axis} />
          {refLines.map((r, i) => <ReferenceLine key={i} y={r.y} stroke={r.color || c.muted} strokeDasharray="4 4" />)}
          {colored.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {colorFor && data.map((d, i) => <Cell key={i} fill={colorFor(d, s, c) || s.color} />)}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Horizontal bars for ranking (one highlighted entity, rest neutral).
export function RankBars({ data, valueKey, labelKey = 'label', highlight, fmt = (v) => v, height }) {
  const c = useColors();
  const h = height || Math.max(120, data.length * 34 + 30);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={c.grid} horizontal={false} />
        <XAxis type="number" {...axisProps(c)} tickFormatter={fmt} />
        <YAxis type="category" dataKey={labelKey} {...axisProps(c)} width={110} axisLine={false} />
        <Tooltip content={<TooltipBox fmt={(v) => fmt(v)} />} cursor={{ fill: c.grid, fillOpacity: 0.5 }} />
        <ReferenceLine x={0} stroke={c.axis} />
        <Bar dataKey={valueKey} name="Value" maxBarSize={20} radius={[0, 4, 4, 0]} isAnimationActive={false}
          label={{ position: 'right', formatter: fmt, fill: c.text2, fontSize: 11 }}>
          {data.map((d, i) => <Cell key={i} fill={d[labelKey] === highlight ? c.s1 : c.neutralMark} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export { LineChart, Line };
