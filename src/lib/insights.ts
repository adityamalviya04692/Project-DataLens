import { isIdentifierLike } from './charts';
import { isNumericText, looksLikeKey } from './quality';
import type { DatasetProfile, Dimension, QualityReport } from './types';

export interface CorrPair {
  a: string;
  b: string;
  r: number;
}

export interface CategoryFact {
  column: string;
  distinct: number;
  /** Non-null rows in the column. */
  total: number;
  top: { value: string; n: number }[];
}

export interface TimeFacts {
  column: string;
  min: string;
  max: string;
  spanDays: number;
  peakMonth: { label: string; n: number } | null;
  busiestDay: { label: string; n: number } | null;
  quietestDay: { label: string; n: number } | null;
}

/** Facts that need extra SQL beyond the column profile. */
export interface InsightExtras {
  /** Numeric pairs sorted by |r|, strongest first. */
  correlations: CorrPair[];
  skew: Record<string, number>;
  categories: CategoryFact[];
  time: TimeFacts | null;
}

export const EMPTY_EXTRAS: InsightExtras = { correlations: [], skew: {}, categories: [], time: null };

export type InsightTone = 'good' | 'info' | 'warn';
export type InsightIcon = 'shape' | 'score' | 'time' | 'link' | 'pie' | 'skew' | 'alert' | 'key' | 'check';

export interface Insight {
  id: string;
  tone: InsightTone;
  icon: InsightIcon;
  title: string;
  detail: string;
}

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 });
const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

export function describeSpan(days: number): string {
  if (days < 60) return `${Math.round(days)} days`;
  if (days < 730) return `${Math.round(days / 30.44)} months`;
  return `${(days / 365.25).toFixed(1)} years`;
}

export function correlationStrength(r: number): 'very strong' | 'strong' | 'moderate' | 'weak' | 'no' {
  const a = Math.abs(r);
  return a >= 0.8 ? 'very strong' : a >= 0.6 ? 'strong' : a >= 0.4 ? 'moderate' : a >= 0.2 ? 'weak' : 'no';
}

/** Plain-English findings about a dataset, most important first. */
export function buildInsights(p: DatasetProfile, q: QualityReport, x: InsightExtras): Insight[] {
  const out: Insight[] = [];
  const add = (i: Insight) => out.push(i);
  const rows = p.rows;
  const col = (name: string) => p.columns.find((c) => c.name === name);

  // Shape
  const kinds = { numeric: 0, text: 0, temporal: 0, boolean: 0, other: 0 };
  p.columns.forEach((c) => kinds[c.kind]++);
  const mix = [
    kinds.numeric && `${kinds.numeric} numeric`,
    kinds.text && `${kinds.text} text`,
    kinds.temporal && `${kinds.temporal} date/time`,
    kinds.boolean && `${kinds.boolean} boolean`,
    kinds.other && `${kinds.other} other`,
  ].filter(Boolean);
  add({ id: 'shape', tone: 'info', icon: 'shape', title: `${fmt(rows)} rows × ${p.columns.length} columns`, detail: mix.join(' · ') });

  // Quality headline
  const weakest = (Object.entries(q.dimensions) as [Dimension, number][]).sort((a, b) => a[1] - b[1])[0];
  add({
    id: 'score',
    tone: q.score >= 85 ? 'good' : q.score >= 65 ? 'info' : 'warn',
    icon: 'score',
    title: `Quality score ${q.score.toFixed(1)} / 100 (grade ${q.grade})`,
    detail: `Weakest dimension is ${weakest[0]} at ${(weakest[1] * 100).toFixed(1)}%.`,
  });

  // Time coverage
  if (x.time) {
    const t = x.time;
    const bits = [`${t.min} → ${t.max}.`];
    if (t.peakMonth && rows > 0) bits.push(`Busiest month: ${t.peakMonth.label} (${pct(t.peakMonth.n / rows)} of rows).`);
    if (t.busiestDay && t.quietestDay && rows > 0 && t.spanDays >= 14) {
      bits.push(`${t.busiestDay.label} is the busiest weekday, ${t.quietestDay.label} the quietest.`);
    }
    add({ id: 'time', tone: 'info', icon: 'time', title: `${t.column} spans ${describeSpan(t.spanDays)}`, detail: bits.join(' ') });
  }

  // Relationships
  const top = x.correlations[0];
  if (top) {
    const s = correlationStrength(top.r);
    if (s === 'no' || s === 'weak') {
      add({ id: 'corr', tone: 'info', icon: 'link', title: 'No strong linear relationships', detail: `The closest pair is ${top.a} ↔ ${top.b} (r = ${top.r.toFixed(2)}).` });
    } else {
      add({
        id: 'corr',
        tone: 'info',
        icon: 'link',
        title: `${top.a} and ${top.b} move ${top.r > 0 ? 'together' : 'in opposite directions'}`,
        detail: `A ${s} ${top.r > 0 ? 'positive' : 'negative'} correlation (r = ${top.r.toFixed(2)}). Worth modelling jointly.`,
      });
    }
  }

  // Categories
  for (const f of x.categories.slice(0, 2)) {
    const lead = f.top[0];
    if (!lead || f.total === 0) continue;
    const share = lead.n / f.total;
    const next = f.top[1];
    if (share >= 0.5) {
      add({ id: `cat:${f.column}`, tone: 'warn', icon: 'pie', title: `“${lead.value}” dominates ${f.column}`, detail: `${pct(share)} of non-null rows across ${fmt(f.distinct)} distinct values. Group-bys will be heavily skewed to it.` });
    } else {
      add({
        id: `cat:${f.column}`,
        tone: 'info',
        icon: 'pie',
        title: `${f.column}: “${lead.value}” leads`,
        detail: `${pct(share)} of rows${next ? `, then “${next.value}” at ${pct(next.n / f.total)}` : ''}. ${fmt(f.distinct)} distinct values.`,
      });
    }
  }

  // Skew
  const skewed = Object.entries(x.skew)
    .filter(([name, s]) => col(name) && Number.isFinite(s) && Math.abs(s) >= 1)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  if (skewed) {
    const c = col(skewed[0])!;
    add({
      id: `skew:${c.name}`,
      tone: 'warn',
      icon: 'skew',
      title: `${c.name} is ${Math.abs(skewed[1]) >= 2 ? 'heavily ' : ''}${skewed[1] > 0 ? 'right' : 'left'}-skewed`,
      detail: `Skewness ${skewed[1].toFixed(1)}${c.mean !== null && c.q50 !== null ? `, mean ${fmt(c.mean)} vs median ${fmt(c.q50)}` : ''}. Prefer the median, or cap / log-transform before averaging.`,
    });
  }

  // Outliers
  const outlying = p.columns
    .filter((c) => c.kind === 'numeric' && c.count > 0 && c.outliers / c.count >= 0.01 && c.name !== skewed?.[0])
    .sort((a, b) => b.outliers / b.count - a.outliers / a.count)[0];
  if (outlying) {
    add({ id: `out:${outlying.name}`, tone: 'warn', icon: 'alert', title: `Outliers in ${outlying.name}`, detail: `${fmt(outlying.outliers)} of ${fmt(outlying.count)} values (${pct(outlying.outliers / outlying.count)}) sit beyond 1.5 × IQR; the maximum is ${outlying.max}.` });
  }

  // Missing data
  const worst = [...p.columns].sort((a, b) => b.nullPct - a.nullPct)[0];
  if (worst && worst.nulls > 0) {
    add({ id: 'missing', tone: worst.nullPct > 0.2 ? 'warn' : 'info', icon: 'alert', title: `${worst.name} is ${pct(worst.nullPct)} missing`, detail: `${fmt(worst.nulls)} null values, the most of any column. Decide whether to impute, drop or leave as unknown.` });
  } else if (rows > 0) {
    add({ id: 'missing', tone: 'good', icon: 'check', title: 'No missing values', detail: 'Every column is fully populated.' });
  }

  // Duplicates
  if (p.duplicateRows > 0) {
    add({ id: 'dups', tone: 'warn', icon: 'alert', title: `${fmt(p.duplicateRows)} duplicate rows (${pct(p.duplicateRows / rows)})`, detail: 'Often a re-run or double ingestion. Dedupe before aggregating, or totals will be inflated.' });
  } else if (rows > 0) {
    add({ id: 'dups', tone: 'good', icon: 'check', title: 'No duplicate rows', detail: 'Every row is unique.' });
  }

  // Keys
  const key = p.columns.find((c) => looksLikeKey(c) && rows > 0 && c.count === rows && c.distinct === rows);
  if (key) add({ id: `key:${key.name}`, tone: 'good', icon: 'key', title: `${key.name} is a clean unique key`, detail: `${fmt(rows)} distinct values, no nulls. Safe to use as a primary key.` });

  // Numbers stored as text
  const numText = p.columns.find((c) => isNumericText(c) && c.count - c.empty - c.numericLike > 0);
  if (numText) {
    const bad = numText.count - numText.empty - numText.numericLike;
    add({ id: `numtext:${numText.name}`, tone: 'warn', icon: 'alert', title: `${numText.name} holds numbers as text`, detail: `${fmt(bad)} non-numeric values (for example “N/A”) stop it loading as a number. Cast with TRY_CAST.` });
  }

  // Constant columns
  const constant = p.columns.filter((c) => rows > 1 && c.count > 0 && c.distinct === 1 && !isIdentifierLike(c, rows));
  if (constant.length > 0) {
    add({ id: 'constant', tone: 'info', icon: 'alert', title: `${constant.length} constant column${constant.length > 1 ? 's' : ''}`, detail: `${constant.map((c) => c.name).join(', ')} ${constant.length > 1 ? 'never change' : 'never changes'}, so ${constant.length > 1 ? 'they add' : 'it adds'} no information.` });
  }

  return out.slice(0, 12);
}
