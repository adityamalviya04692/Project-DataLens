import { quoteIdent, timeGrain } from './sql';
import { isNumericText, looksLikeKey } from './quality';
import type { ColumnProfile, DatasetProfile } from './types';

export type ChartKind =
  | 'timeseries'
  | 'stacked'
  | 'weekday'
  | 'month'
  | 'heatmap'
  | 'scatter'
  | 'histogram'
  | 'bar'
  | 'boxplot';

export type ChartSection = 'Trends' | 'Relationships' | 'Distributions' | 'Categories';

export const SECTION_ORDER: ChartSection[] = ['Trends', 'Relationships', 'Distributions', 'Categories'];

export const SECTION_BLURB: Record<ChartSection, string> = {
  Trends: 'How the data moves over time and across the calendar.',
  Relationships: 'Which numeric columns move together.',
  Distributions: 'How values spread out, where they cluster and where the outliers sit.',
  Categories: 'The most common values and how groups compare.',
};

export interface ChartSpec {
  id: string;
  kind: ChartKind;
  section: ChartSection;
  columns: string[];
  title: string;
  subtitle: string;
}

export interface ChartHints {
  /** The strongest-correlated numeric pair, used for the scatter plot. */
  pair?: [string, string];
}

export const HISTOGRAM_BINS = 20;
export const SCATTER_SAMPLE = 1500;
const MAX_HEATMAP_COLUMNS = 8;

/** Unique or ID-like columns make meaningless charts. */
export function isIdentifierLike(c: ColumnProfile, rows: number): boolean {
  return looksLikeKey(c) || (c.kind === 'text' && rows > 20 && c.distinct >= rows * 0.95);
}

const CONTINUOUS_MIN_DISTINCT = 12;

/** Numeric column with enough distinct values to be treated as a measurement, not a code. */
export function isContinuous(c: ColumnProfile): boolean {
  return c.kind === 'numeric' && c.distinct > CONTINUOUS_MIN_DISTINCT;
}

/** The most strongly correlated pair where both columns are continuous. */
export function strongestContinuousPair(
  p: DatasetProfile,
  correlations: { a: string; b: string; r: number }[],
): [string, string] | undefined {
  const ok = (name: string) => {
    const c = p.columns.find((x) => x.name === name);
    return !!c && isContinuous(c);
  };
  const hit = correlations.find((x) => ok(x.a) && ok(x.b));
  return hit ? [hit.a, hit.b] : undefined;
}

export function spanDays(min: string | null, max: string | null): number {
  const a = min ? Date.parse(min) : NaN;
  const b = max ? Date.parse(max) : NaN;
  return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(b - a) / 86_400_000 : 0;
}

function histogramSubtitle(c: ColumnProfile): string {
  const r = histogramRange(c);
  if (r.integer) return 'One bar per value';
  if (r.clippedLow || r.clippedHigh) return `${r.bins} bins · outliers grouped into the edge bars`;
  return `${r.bins} equal-width bins`;
}

/** Pick the charts a data analyst would draw first, based only on the profile. */
export function recommendCharts(p: DatasetProfile, max = 16, hints: ChartHints = {}): ChartSpec[] {
  const usable = p.columns.filter((c) => c.count > 0 && c.distinct > 1 && !isIdentifierLike(c, p.rows));
  const temporal = usable.filter((c) => c.kind === 'temporal');
  const numeric = usable.filter((c) => c.kind === 'numeric');
  const texts = usable.filter((c) => c.kind === 'text' && !isNumericText(c));
  const specs: ChartSpec[] = [];

  // Trends
  for (const c of temporal.slice(0, 2)) {
    specs.push({ id: `ts:${c.name}`, kind: 'timeseries', section: 'Trends', columns: [c.name], title: 'Records over time', subtitle: `by ${c.name}` });
  }
  const t0 = temporal[0];
  if (t0) {
    const stack = texts.filter((c) => c.distinct <= 8).sort((a, b) => a.distinct - b.distinct)[0];
    if (stack) {
      specs.push({ id: `stacked:${t0.name}:${stack.name}`, kind: 'stacked', section: 'Trends', columns: [t0.name, stack.name], title: `Records over time by ${stack.name}`, subtitle: 'Top 5 values stacked, the rest grouped as Other' });
    }
    const span = spanDays(t0.min, t0.max);
    if (span >= 14) {
      specs.push({ id: `dow:${t0.name}`, kind: 'weekday', section: 'Trends', columns: [t0.name], title: 'Records by day of week', subtitle: `by ${t0.name}` });
    }
    if (span >= 300) {
      specs.push({ id: `moy:${t0.name}`, kind: 'month', section: 'Trends', columns: [t0.name], title: 'Seasonality by month', subtitle: `records per calendar month, by ${t0.name}` });
    }
  }

  // Relationships
  if (numeric.length >= 2) {
    const cols = numeric.slice(0, MAX_HEATMAP_COLUMNS).map((c) => c.name);
    specs.push({ id: 'heatmap', kind: 'heatmap', section: 'Relationships', columns: cols, title: 'Correlation matrix', subtitle: `Pearson r across ${cols.length} numeric columns` });
    // A scatter plot only reads well when both axes are continuous, not a handful of discrete values.
    const continuous = numeric.filter(isContinuous);
    if (continuous.length >= 2) {
      const [a, b] = hints.pair ?? [continuous[0].name, continuous[1].name];
      specs.push({ id: `scatter:${a}:${b}`, kind: 'scatter', section: 'Relationships', columns: [a, b], title: `${a} vs ${b}`, subtitle: `Random sample of up to ${SCATTER_SAMPLE.toLocaleString('en-US')} rows · extreme outliers hidden` });
    }
  }

  // Distributions
  for (const c of numeric.slice(0, 4)) {
    specs.push({ id: `hist:${c.name}`, kind: 'histogram', section: 'Distributions', columns: [c.name], title: `Distribution of ${c.name}`, subtitle: histogramSubtitle(c) });
  }

  // Categories
  const categorical = usable
    .filter((c) => c.kind === 'boolean' || (c.kind === 'text' && c.distinct <= Math.max(50, p.rows * 0.5)))
    .sort((a, b) => a.distinct - b.distinct);
  for (const c of categorical.slice(0, 4)) {
    specs.push({ id: `bar:${c.name}`, kind: 'bar', section: 'Categories', columns: [c.name], title: `Top values of ${c.name}`, subtitle: `${c.distinct.toLocaleString('en-US')} distinct values` });
  }
  const boxCat = texts.filter((c) => c.distinct >= 3 && c.distinct <= 10).sort((a, b) => b.distinct - a.distinct)[0];
  const measure = numeric.find((c) => c.distinct > 20);
  if (boxCat && measure) {
    specs.push({ id: `box:${boxCat.name}:${measure.name}`, kind: 'boxplot', section: 'Categories', columns: [boxCat.name, measure.name], title: `${measure.name} by ${boxCat.name}`, subtitle: 'Box = middle 50% with the median; whiskers = 5th to 95th percentile' });
  }

  return specs.slice(0, max);
}

/** A single-column chart for the column explorer. */
export function specForColumn(c: ColumnProfile): ChartSpec | null {
  if (c.count === 0 || c.distinct < 2) return null;
  switch (c.kind) {
    case 'temporal':
      return { id: `col-ts:${c.name}`, kind: 'timeseries', section: 'Trends', columns: [c.name], title: 'Records over time', subtitle: `by ${c.name}` };
    case 'numeric':
      return { id: `col-hist:${c.name}`, kind: 'histogram', section: 'Distributions', columns: [c.name], title: `Distribution of ${c.name}`, subtitle: histogramSubtitle(c) };
    case 'text':
    case 'boolean':
      return { id: `col-bar:${c.name}`, kind: 'bar', section: 'Categories', columns: [c.name], title: `Top values of ${c.name}`, subtitle: `${c.distinct.toLocaleString('en-US')} distinct values` };
    default:
      return null;
  }
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
    case 'stacked': {
      const tc = col(spec.columns[0]);
      const g = timeGrain(spanDays(tc.min, tc.max));
      const grain = g === 'day' ? 'week' : g;
      const qt = quoteIdent(tc.name);
      const qc = quoteIdent(spec.columns[1]);
      return (
        `WITH top AS (SELECT CAST(${qc} AS VARCHAR) AS v FROM ${t} WHERE ${qc} IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 5) ` +
        `SELECT CAST(date_trunc('${grain}', ${qt}) AS DATE) AS period, ` +
        `CASE WHEN CAST(${qc} AS VARCHAR) IN (SELECT v FROM top) THEN CAST(${qc} AS VARCHAR) ELSE 'Other' END AS label, ` +
        `count(*)::BIGINT AS n FROM ${t} WHERE ${qt} IS NOT NULL AND ${qc} IS NOT NULL GROUP BY 1, 2 ORDER BY 1`
      );
    }
    case 'weekday': {
      const q = quoteIdent(spec.columns[0]);
      return `SELECT isodow(${q})::INTEGER AS dow, count(*)::BIGINT AS n FROM ${t} WHERE ${q} IS NOT NULL GROUP BY 1 ORDER BY 1`;
    }
    case 'month': {
      const q = quoteIdent(spec.columns[0]);
      return `SELECT month(${q})::INTEGER AS m, count(*)::BIGINT AS n FROM ${t} WHERE ${q} IS NOT NULL GROUP BY 1 ORDER BY 1`;
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
    case 'boxplot': {
      const qc = quoteIdent(spec.columns[0]);
      const qm = quoteIdent(spec.columns[1]);
      return (
        `SELECT label, p05, q25, q50, q75, p95, n FROM (SELECT CAST(${qc} AS VARCHAR) AS label, ` +
        `quantile_cont(${qm}, 0.05)::DOUBLE AS p05, quantile_cont(${qm}, 0.25)::DOUBLE AS q25, quantile_cont(${qm}, 0.5)::DOUBLE AS q50, ` +
        `quantile_cont(${qm}, 0.75)::DOUBLE AS q75, quantile_cont(${qm}, 0.95)::DOUBLE AS p95, count(*)::BIGINT AS n ` +
        `FROM ${t} WHERE ${qc} IS NOT NULL AND ${qm} IS NOT NULL GROUP BY 1) ORDER BY q50 DESC LIMIT 12`
      );
    }
    case 'scatter': {
      const [a, b] = spec.columns;
      const qa = quoteIdent(a);
      const qb = quoteIdent(b);
      // Hide extreme outliers (beyond 3 × IQR) so the cloud stays readable.
      const fence = (c: ColumnProfile, q: string) => {
        if (c.q25 === null || c.q75 === null) return '';
        const iqr = c.q75 - c.q25;
        return iqr > 0 ? ` AND ${q} BETWEEN ${c.q25 - 3 * iqr} AND ${c.q75 + 3 * iqr}` : '';
      };
      return (
        `SELECT ${qa} AS x, ${qb} AS y FROM (SELECT * FROM ${t} WHERE ${qa} IS NOT NULL AND ${qb} IS NOT NULL` +
        `${fence(col(a), qa)}${fence(col(b), qb)}) USING SAMPLE reservoir(${SCATTER_SAMPLE} ROWS) REPEATABLE (42)`
      );
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
