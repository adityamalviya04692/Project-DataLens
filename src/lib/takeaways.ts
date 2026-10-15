import type { ChartSpec } from './charts';
import { correlationStrength } from './insights';
import type { Row } from './duckdb';
import type { DatasetProfile } from './types';

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 });
const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = avg(xs);
  const my = avg(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Counts per calendar slot (7 weekdays or 12 months), zero-filled. */
export function slotCounts(rows: Row[], key: 'dow' | 'm', size: number): number[] {
  const out = new Array<number>(size).fill(0);
  rows.forEach((r) => {
    const i = Number(r[key]) - 1;
    if (i >= 0 && i < size) out[i] = Number(r.n);
  });
  return out;
}

function extremes(values: number[], labels: string[]) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  return { hi: labels[values.indexOf(max)], lo: labels[values.indexOf(min)], max, min, total: values.reduce((a, b) => a + b, 0) };
}

/** One-line "so what" caption for a chart, computed from the data it shows. */
export function takeaway(spec: ChartSpec, rows: Row[], p: DatasetProfile): string | null {
  const col = (name: string) => p.columns.find((c) => c.name === name);
  switch (spec.kind) {
    case 'timeseries': {
      if (rows.length < 3) return null;
      const ns = rows.map((r) => Number(r.n));
      const peak = ns.indexOf(Math.max(...ns));
      const k = Math.max(1, Math.floor(ns.length / 3));
      const first = avg(ns.slice(0, k));
      const last = avg(ns.slice(-k));
      const change = first > 0 ? (last - first) / first : 0;
      const trend = Math.abs(change) < 0.05 ? 'Flat overall' : `${change > 0 ? 'Up' : 'Down'} ${Math.round(Math.abs(change) * 100)}% from the first to the last third`;
      return `Peak: ${String(rows[peak].period)} (${fmt(ns[peak])} rows). ${trend}.`;
    }
    case 'stacked': {
      const totals = new Map<string, number>();
      rows.forEach((r) => totals.set(String(r.label), (totals.get(String(r.label)) ?? 0) + Number(r.n)));
      const sum = [...totals.values()].reduce((a, b) => a + b, 0);
      const top = [...totals].sort((a, b) => b[1] - a[1])[0];
      return top && sum > 0 ? `“${top[0]}” is the largest segment at ${pct(top[1] / sum)} of rows.` : null;
    }
    case 'weekday': {
      const e = extremes(slotCounts(rows, 'dow', 7), DAYS);
      return e.total > 0 ? `Busiest: ${e.hi} (${pct(e.max / e.total)}). Quietest: ${e.lo} (${pct(e.min / e.total)}).` : null;
    }
    case 'month': {
      const e = extremes(slotCounts(rows, 'm', 12), MONTHS);
      return e.total > 0 ? `Peak month: ${e.hi} (${pct(e.max / e.total)}). Lowest: ${e.lo} (${pct(e.min / e.total)}).` : null;
    }
    case 'histogram': {
      const c = col(spec.columns[0]);
      if (!c || c.q50 === null || c.mean === null) return null;
      const tail = c.q50 > 0 && c.mean > c.q50 * 1.25 ? ' A long right tail pulls the mean above the median.' : '';
      const out = c.outliers > 0 ? ` ${fmt(c.outliers)} outliers fall outside the fences.` : '';
      return `Median ${fmt(c.q50)}, mean ${fmt(c.mean)}.${tail}${out}`;
    }
    case 'bar': {
      const c = col(spec.columns[0]);
      const top = rows[0];
      return c && top && c.count > 0 ? `Most common: “${String(top.label).trim() || '(blank)'}” at ${pct(Number(top.n) / c.count)} of ${fmt(c.count)} non-null values.` : null;
    }
    case 'boxplot': {
      const sorted = [...rows].sort((a, b) => Number(b.q50) - Number(a.q50));
      if (sorted.length < 2) return null;
      const hi = sorted[0];
      const lo = sorted[sorted.length - 1];
      const ratio = Number(lo.q50) > 0 ? ` (${(Number(hi.q50) / Number(lo.q50)).toFixed(1)}× gap)` : '';
      return `Median ${spec.columns[1]} is highest for “${String(hi.label)}” (${fmt(Number(hi.q50))}) and lowest for “${String(lo.label)}” (${fmt(Number(lo.q50))})${ratio}.`;
    }
    case 'scatter': {
      const r = pearson(rows.map((x) => Number(x.x)), rows.map((x) => Number(x.y)));
      if (r === null) return null;
      const s = correlationStrength(r);
      return s === 'no' ? `r = ${r.toFixed(2)}: no linear relationship in this sample.` : `r = ${r.toFixed(2)}: a ${s} ${r > 0 ? 'positive' : 'negative'} relationship (${fmt(rows.length)} sampled rows, extreme outliers hidden).`;
    }
    case 'heatmap': {
      const row = rows[0];
      if (!row) return null;
      let best: { a: string; b: string; r: number } | null = null;
      spec.columns.forEach((a, i) =>
        spec.columns.forEach((b, j) => {
          const r = row[`r_${i}_${j}`];
          if (j > i && typeof r === 'number' && Number.isFinite(r) && (!best || Math.abs(r) > Math.abs(best.r))) best = { a, b, r };
        }),
      );
      const b = best as { a: string; b: string; r: number } | null;
      return b ? `Strongest pair: ${b.a} ↔ ${b.b} (r = ${b.r.toFixed(2)}).` : null;
    }
  }
}
