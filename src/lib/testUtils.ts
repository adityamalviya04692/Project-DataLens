import { columnKind } from './sql';
import type { ColumnProfile, DatasetProfile } from './types';

export function col(name: string, type: string, overrides: Partial<ColumnProfile> = {}, rows = 100): ColumnProfile {
  const count = overrides.count ?? rows;
  return {
    name,
    type,
    kind: columnKind(type),
    count,
    nulls: rows - count,
    nullPct: rows === 0 ? 0 : (rows - count) / rows,
    distinct: 10,
    min: null,
    max: null,
    mean: null,
    std: null,
    q25: null,
    q50: null,
    q75: null,
    whitespace: 0,
    empty: 0,
    numericLike: 0,
    negatives: 0,
    outliers: 0,
    ...overrides,
  };
}

export function dataset(columns: ColumnProfile[], rows = 100, duplicateRows = 0): DatasetProfile {
  return { table: 'data', rows, duplicateRows, columns, elapsedMs: 0 };
}
