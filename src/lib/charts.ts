import { quoteIdent, timeGrain } from './sql';
import { looksLikeKey } from './quality';
import type { ColumnProfile, DatasetProfile } from './types';

export type ChartKind = 'timeseries' | 'histogram' | 'bar' | 'heatmap';

export interface ChartSpec {
  id: string;
  kind: ChartKind;
  columns: string[];
  title: string;
  subtitle: string;
}

export const HISTOGRAM_BINS = 20;
const MAX_HEATMAP_COLUMNS = 8;

/** Unique or ID-like columns make meaningless charts. */
export function isIdentifierLike(c: ColumnProfile, rows: number): boolean {
  return looksLikeKey(c) || (c.kind === 'text' && rows > 20 && c.distinct >= rows * 0.95);
}

/** Pick the charts a data analyst would draw first, based only on the profile. */
export function recommendCharts(p: DatasetProfile, max = 10): ChartSpec[] {
  const usable = p.columns.filter((c) => c.count > 0 && c.distinct > 1 && !isIdentifierLike(c, p.rows));
  const specs: ChartSpec[] = [];

  for (const c of usable.filter((c) => c.kind === 'temporal').slice(0, 2)) {
    specs.push({ id: `ts:${c.name}`, kind: 'timeseries', columns: [c.name], title: 'Records over time', subtitle: `by ${c.name}` });
  }

  const numeric = usable.filter((c) => c.kind === 'numeric');
  if (numeric.length >= 2) {
    const cols = numeric.slice(0, MAX_HEATMAP_COLUMNS).map((c) => c.name);
    specs.push({ id: 'heatmap', kind: 'heatmap', columns: cols, title: 'Correlation matrix', subtitle: `Pearson r across ${cols.length} numeric columns` });
  }

  for (const c of numeric.slice(0, 4)) {
    const r = histogramRange(c);
    const subtitle = r.integer
      ? 'One bar per value'
      : r.clippedLow || r.clippedHigh
        ? `${r.bins} bins · outliers grouped into the edge bars`
        : `${r.bins} equal-width bins`;
    specs.push({ id: `hist:${c.name}`, kind: 'histogram', columns: [c.name], title: `Distribution of ${c.name}`, subtitle });
  }

  const categorical = usable
    .filter((c) => c.kind === 'boolean' || (c.kind === 'text' && c.distinct <= Math.max(50, p.rows * 0.5)))
    .sort((a, b) => a.distinct - b.distinct);
  for (const c of categorical.slice(0, 4)) {
    specs.push({ id: `bar:${c.name}`, kind: 'bar', columns: [c.name], title: `Top values of ${c.name}`, subtitle: `${c.distinct.toLocaleString('en-US')} distinct values` });
  }

  return specs.slice(0, max);
}

function spanDays(min: string | null, max: string | null): number {
  const a = min ? Date.parse(min) : NaN;
  const b = max ? Date.parse(max) : NaN;
  return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(b - a) / 86_400_000 : 0;
}

/** SQL that returns the data for a chart spec. */
export function chartSql(spec: ChartSpec, p: DatasetProfile): string {
  const t = p.table;
  const col = (name: string) => p.columns.find((c) => c.name === name)!;
  switch (spec.kind) {
    case 'timeseries': {
      const c = col(spec.columns[0]);
      const grain = timeGrain(spanDays(c.min, c.max));
      const q = quoteIdent(c.name);
      return `SELECT CAST(date_trunc('${grain}', ${q}) AS DATE) AS period, count(*)::BIGINT AS n FROM ${t} WHERE ${q} IS NOT NULL GROUP BY 1 ORDER BY 1`;
    }
    case 'histogram': {
      const c = col(spec.columns[0]);
      const q = quoteIdent(c.name);
      const { lo, width, bins } = histogramRange(c);
      // Values outside [lo, hi) are clamped into the first/last bin.
      return `SELECT GREATEST(0, LEAST(floor((${q} - ${lo}) / ${width}), ${bins - 1}))::INTEGER AS bin, count(*)::BIGINT AS n FROM ${t} WHERE ${q} IS NOT NULL GROUP BY 1 ORDER BY 1`;
    }
    case 'bar': {
      const q = quoteIdent(spec.columns[0]);
      return `SELECT COALESCE(CAST(${q} AS VARCHAR), '(null)') AS label, count(*)::BIGINT AS n FROM ${t} GROUP BY 1 ORDER BY n DESC, label LIMIT 10`;
    }
    case 'heatmap': {
      const parts: string[] = [];
      spec.columns.forEach((a, i) =>
        spec.columns.forEach((b, j) => {
          if (j > i) parts.push(`corr(${quoteIdent(a)}, ${quoteIdent(b)})::DOUBLE AS r_${i}_${j}`);
        }),
      );
      return `SELECT ${parts.join(', ')} FROM ${t}`;
    }
  }
}

export interface HistogramRange {
  lo: number;
  hi: number;
  bins: number;
  width: number;
  /** Small integer range: one bar per value. */
  integer: boolean;
  clippedLow: boolean;
  clippedHigh: boolean;
}

const MAX_INTEGER_BARS = 40;

/**
 * Bin layout for a numeric column. Extreme outliers would squash a plain
 * min–max histogram into a single bar, so the range is clipped to the
 * 1.5 × IQR fences and outliers land in the edge bins.
 */
export function histogramRange(c: ColumnProfile): HistogramRange {
  const min = Number(c.min);
  const max = Number(c.max);
  const isInt = /INT/i.test(c.type) && !/\[/.test(c.type);
  if (isInt && max - min < MAX_INTEGER_BARS) {
    return { lo: min, hi: max + 1, bins: max - min + 1, width: 1, integer: true, clippedLow: false, clippedHigh: false };
  }
  let lo = min;
  let hi = max;
  if (c.q25 !== null && c.q75 !== null) {
    const iqr = c.q75 - c.q25;
    lo = Math.max(min, c.q25 - 1.5 * iqr);
    hi = Math.min(max, c.q75 + 1.5 * iqr);
    if (!(hi > lo)) {
      lo = min;
      hi = max;
    }
  }
  const width = hi > lo ? (hi - lo) / HISTOGRAM_BINS : 1;
  return { lo, hi, bins: HISTOGRAM_BINS, width, integer: false, clippedLow: lo > min, clippedHigh: hi < max };
}

/** Human labels for histogram bins, e.g. "10 – 15", "< 20", "≥ 900". */
export function binLabels(r: HistogramRange): string[] {
  const f = (n: number) => (Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-US') : Number(n.toPrecision(3)).toString());
  return Array.from({ length: r.bins }, (_, i) => {
    const a = r.lo + i * r.width;
    const b = a + r.width;
    if (r.integer) return String(a);
    if (i === 0 && r.clippedLow) return `< ${f(b)}`;
    if (i === r.bins - 1 && r.clippedHigh) return `≥ ${f(a)}`;
    return `${f(a)} – ${f(b)}`;
  });
}
