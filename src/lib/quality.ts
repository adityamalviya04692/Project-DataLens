import type { ColumnProfile, DatasetProfile, Dimension, Issue, QualityReport } from './types';

/** Column names where a negative value is almost certainly a data error. */
const NON_NEGATIVE_NAME = /(price|amount|qty|quantity|age|count|cost|revenue|salary|weight|height|days|units|total)/i;
const KEY_NAME = /(^id$|_id$|^id_|uuid|key$)/i;

export const WEIGHTS: Record<Dimension, number> = {
  completeness: 0.3,
  validity: 0.3,
  uniqueness: 0.25,
  consistency: 0.15,
};

export function expectsNonNegative(c: ColumnProfile): boolean {
  return c.kind === 'numeric' && NON_NEGATIVE_NAME.test(c.name);
}

export function looksLikeKey(c: ColumnProfile): boolean {
  return KEY_NAME.test(c.name);
}

/** A text column where most non-empty values parse as numbers: a type problem. */
export function isNumericText(c: ColumnProfile): boolean {
  if (c.kind !== 'text') return false;
  const nonEmpty = c.count - c.empty;
  return nonEmpty > 0 && c.numericLike / nonEmpty >= 0.8;
}

/** Cells in a column that fail a validity rule (capped at the non-null count). */
export function invalidCells(c: ColumnProfile): number {
  let bad = c.whitespace + c.empty;
  if (isNumericText(c)) bad += c.count - c.empty - c.numericLike;
  if (expectsNonNegative(c)) bad += c.negatives;
  return Math.min(bad, c.count);
}

const pct = (n: number, d: number) => (d === 0 ? '0%' : `${((n / d) * 100).toFixed(n / d < 0.01 ? 2 : 1)}%`);
const fmt = (n: number) => n.toLocaleString('en-US');

export function findIssues(p: DatasetProfile): Issue[] {
  const issues: Issue[] = [];
  const add = (i: Omit<Issue, 'id'>) => issues.push({ id: `${i.dimension}:${i.column ?? '*'}:${i.title}`, ...i });

  if (p.duplicateRows > 0) {
    add({
      severity: p.duplicateRows / p.rows > 0.05 ? 'error' : 'warning',
      dimension: 'uniqueness',
      title: 'Duplicate rows',
      detail: `${fmt(p.duplicateRows)} rows (${pct(p.duplicateRows, p.rows)}) are exact copies of another row.`,
      affected: p.duplicateRows,
    });
  }

  for (const c of p.columns) {
    const base = { column: c.name };
    if (p.rows > 0 && c.count === 0) {
      add({ ...base, severity: 'error', dimension: 'consistency', title: 'Empty column', detail: 'Every value is null. Consider dropping it.', affected: p.rows });
      continue;
    }
    if (c.nulls > 0) {
      add({
        ...base,
        severity: c.nullPct > 0.5 ? 'error' : c.nullPct > 0.05 ? 'warning' : 'info',
        dimension: 'completeness',
        title: 'Missing values',
        detail: `${fmt(c.nulls)} nulls (${pct(c.nulls, p.rows)}).`,
        affected: c.nulls,
      });
    }
    if (p.rows > 1 && c.distinct === 1) {
      add({ ...base, severity: 'info', dimension: 'consistency', title: 'Constant value', detail: `Only one distinct value (${c.min ?? 'null'}). It carries no information.`, affected: c.count });
    }
    if (c.whitespace > 0) {
      add({ ...base, severity: 'warning', dimension: 'validity', title: 'Untrimmed whitespace', detail: `${fmt(c.whitespace)} values have leading or trailing spaces, which breaks joins and group-bys.`, affected: c.whitespace });
    }
    if (c.empty > 0) {
      add({ ...base, severity: 'warning', dimension: 'validity', title: 'Empty strings', detail: `${fmt(c.empty)} blank values that should probably be null.`, affected: c.empty });
    }
    if (isNumericText(c)) {
      const bad = c.count - c.empty - c.numericLike;
      add({
        ...base,
        severity: bad > 0 ? 'warning' : 'info',
        dimension: 'consistency',
        title: 'Numbers stored as text',
        detail:
          bad > 0
            ? `${pct(c.numericLike, c.count - c.empty)} of values are numeric, but ${fmt(bad)} are not (e.g. "N/A"), so the column was read as text.`
            : 'All values are numeric but the column is typed as text.',
        affected: Math.max(bad, 0),
      });
    }
    if (expectsNonNegative(c) && c.negatives > 0) {
      add({ ...base, severity: 'warning', dimension: 'validity', title: 'Unexpected negatives', detail: `${fmt(c.negatives)} values are below zero, which is unusual for “${c.name}”.`, affected: c.negatives });
    }
    if (c.outliers > 0) {
      add({ ...base, severity: 'info', dimension: 'validity', title: 'Outliers', detail: `${fmt(c.outliers)} values (${pct(c.outliers, c.count)}) fall outside 1.5 × IQR.`, affected: c.outliers });
    }
    if (looksLikeKey(c) && c.distinct < c.count && c.distinct / c.count > 0.5) {
      add({ ...base, severity: 'warning', dimension: 'uniqueness', title: 'Duplicate keys', detail: `Looks like an identifier but has ${fmt(c.count - c.distinct)} repeated values.`, affected: c.count - c.distinct });
    }
  }

  const order = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity] || b.affected - a.affected);
}

export function dimensionScores(p: DatasetProfile): Record<Dimension, number> {
  const cols = p.columns;
  if (p.rows === 0 || cols.length === 0) {
    return { completeness: 1, uniqueness: 1, validity: 1, consistency: 1 };
  }
  const mean = (xs: number[]) => (xs.length === 0 ? 1 : xs.reduce((a, b) => a + b, 0) / xs.length);

  const completeness = mean(cols.map((c) => 1 - c.nullPct));
  const uniqueness = 1 - p.duplicateRows / p.rows;
  const validity = mean(cols.filter((c) => c.count > 0).map((c) => 1 - invalidCells(c) / c.count));
  const inconsistent = cols.filter(
    (c) => c.count === 0 || (p.rows > 1 && c.distinct === 1) || (isNumericText(c) && c.count - c.empty - c.numericLike > 0),
  ).length;
  const consistency = 1 - inconsistent / cols.length;

  return { completeness, uniqueness, validity, consistency };
}

export function grade(score: number): QualityReport['grade'] {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

export function assessQuality(p: DatasetProfile): QualityReport {
  const dimensions = dimensionScores(p);
  const weighted = (Object.keys(WEIGHTS) as Dimension[]).reduce((s, d) => s + dimensions[d] * WEIGHTS[d], 0);
  const score = Math.round(weighted * 1000) / 10;
  return { score, grade: grade(score), dimensions, issues: findIssues(p) };
}
