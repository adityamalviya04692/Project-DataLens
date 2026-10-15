import type { ColumnKind } from './sql';

export interface ColumnProfile {
  name: string;
  type: string;
  kind: ColumnKind;
  /** Non-null values. */
  count: number;
  nulls: number;
  /** Null fraction, 0..1. */
  nullPct: number;
  distinct: number;
  min: string | null;
  max: string | null;
  mean: number | null;
  std: number | null;
  q25: number | null;
  q50: number | null;
  q75: number | null;
  /** Text: values with leading/trailing whitespace. */
  whitespace: number;
  /** Text: values that are empty after trimming. */
  empty: number;
  /** Text: values that parse as a number. */
  numericLike: number;
  /** Numeric: values below zero. */
  negatives: number;
  /** Numeric: values outside 1.5 × IQR. */
  outliers: number;
}

export interface DatasetProfile {
  table: string;
  rows: number;
  duplicateRows: number;
  columns: ColumnProfile[];
  elapsedMs: number;
}

export type Severity = 'error' | 'warning' | 'info';
export type Dimension = 'completeness' | 'uniqueness' | 'validity' | 'consistency';

export interface Issue {
  id: string;
  severity: Severity;
  dimension: Dimension;
  column?: string;
  title: string;
  detail: string;
  affected: number;
}

export interface QualityReport {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  dimensions: Record<Dimension, number>;
  issues: Issue[];
}
