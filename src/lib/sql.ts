/** Quote an identifier (column / table name) for DuckDB. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Quote a string literal for DuckDB. */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export type ColumnKind = 'numeric' | 'temporal' | 'boolean' | 'text' | 'other';

const NUMERIC = /^(TINYINT|SMALLINT|INTEGER|INT|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|REAL|DOUBLE|DECIMAL)/;
// Plain TIME has no calendar span, so it is treated as 'other'.
const TEMPORAL = /^(DATE|TIMESTAMP)/;

/** Map a DuckDB type name (e.g. "DECIMAL(10,2)", "TIMESTAMP WITH TIME ZONE") to a kind. */
export function columnKind(duckType: string): ColumnKind {
  const t = duckType.toUpperCase().trim();
  // Nested types (INTEGER[], STRUCT(...), MAP(...)) are not scalar.
  if (t.endsWith(']') || /^(STRUCT|MAP|UNION)\b/.test(t)) return 'other';
  if (NUMERIC.test(t)) return 'numeric';
  if (TEMPORAL.test(t)) return 'temporal';
  if (t === 'BOOLEAN' || t === 'BOOL') return 'boolean';
  if (t === 'VARCHAR' || t.startsWith('VARCHAR') || t === 'TEXT' || t === 'STRING') return 'text';
  return 'other';
}

/** Choose a date_trunc grain so a time series has a readable number of points. */
export function timeGrain(spanDays: number): 'day' | 'week' | 'month' | 'year' {
  if (spanDays > 365 * 8) return 'year';
  if (spanDays > 365 * 2) return 'month';
  if (spanDays > 120) return 'week';
  return 'day';
}
