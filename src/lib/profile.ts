import { query, type Row } from './duckdb';
import { buildDuplicateSql, buildOutlierSql, buildStatsSql, toColumnMeta } from './profileSql';
import type { ColumnProfile, DatasetProfile } from './types';

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** Profile a DuckDB table: three set-based SQL passes, no row-by-row JS. */
export async function profileTable(table: string): Promise<DatasetProfile> {
  const t0 = performance.now();
  const describe = await query(`DESCRIBE ${table}`);
  const cols = toColumnMeta(describe.rows as { column_name: unknown; column_type: unknown }[]);

  const stats = (await query(buildStatsSql(table, cols))).rows[0] as Row;
  const rows = num(stats.total_rows);

  const columns: ColumnProfile[] = cols.map((c, i) => {
    const g = (metric: string) => stats[`c${i}_${metric}`];
    const count = num(g('count'));
    return {
      name: c.name,
      type: c.type,
      kind: c.kind,
      count,
      nulls: rows - count,
      nullPct: rows === 0 ? 0 : (rows - count) / rows,
      distinct: num(g('distinct')),
      min: strOrNull(g('min')),
      max: strOrNull(g('max')),
      mean: numOrNull(g('mean')),
      std: numOrNull(g('std')),
      q25: numOrNull(g('q25')),
      q50: numOrNull(g('q50')),
      q75: numOrNull(g('q75')),
      whitespace: num(g('whitespace')),
      empty: num(g('empty')),
      numericLike: num(g('numeric_like')),
      negatives: num(g('negatives')),
      outliers: 0,
    };
  });

  const numeric = columns
    .map((c, index) => ({ index, name: c.name, q25: c.q25, q75: c.q75 }))
    .filter((c): c is { index: number; name: string; q25: number; q75: number } =>
      c.q25 !== null && c.q75 !== null && Number.isFinite(c.q25) && Number.isFinite(c.q75),
    );
  const outlierSql = buildOutlierSql(table, numeric);
  if (outlierSql) {
    const o = (await query(outlierSql)).rows[0] as Row;
    for (const { index } of numeric) columns[index].outliers = num(o[`c${index}_outliers`]);
  }

  const dup = (await query(buildDuplicateSql(table))).rows[0] as Row;

  return {
    table,
    rows,
    duplicateRows: num(dup.duplicate_rows),
    columns,
    elapsedMs: performance.now() - t0,
  };
}
