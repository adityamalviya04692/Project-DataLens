import { columnKind, quoteIdent, type ColumnKind } from './sql';

export interface ColumnMeta {
  name: string;
  type: string;
  kind: ColumnKind;
}

export function toColumnMeta(describeRows: { column_name: unknown; column_type: unknown }[]): ColumnMeta[] {
  return describeRows.map((r) => {
    const type = String(r.column_type);
    return { name: String(r.column_name), type, kind: columnKind(type) };
  });
}

/**
 * One aggregate pass over the table that computes every per-column metric.
 * Aliases are positional (c{i}_{metric}) so arbitrary column names are safe.
 */
export function buildStatsSql(table: string, cols: ColumnMeta[]): string {
  const parts: string[] = ['count(*)::BIGINT AS total_rows'];
  cols.forEach((c, i) => {
    const q = quoteIdent(c.name);
    const p = `c${i}_`;
    parts.push(`count(${q})::BIGINT AS ${p}count`);
    if (c.kind !== 'other') {
      parts.push(`count(DISTINCT ${q})::BIGINT AS ${p}distinct`);
      parts.push(`CAST(min(${q}) AS VARCHAR) AS ${p}min`, `CAST(max(${q}) AS VARCHAR) AS ${p}max`);
    } else {
      parts.push(`count(DISTINCT CAST(${q} AS VARCHAR))::BIGINT AS ${p}distinct`);
    }
    if (c.kind === 'numeric') {
      parts.push(
        `avg(${q})::DOUBLE AS ${p}mean`,
        `stddev_samp(${q})::DOUBLE AS ${p}std`,
        `quantile_cont(${q}, 0.25)::DOUBLE AS ${p}q25`,
        `quantile_cont(${q}, 0.5)::DOUBLE AS ${p}q50`,
        `quantile_cont(${q}, 0.75)::DOUBLE AS ${p}q75`,
        `count_if(${q} < 0)::BIGINT AS ${p}negatives`,
      );
    }
    if (c.kind === 'text') {
      parts.push(
        `count_if(${q} <> trim(${q}))::BIGINT AS ${p}whitespace`,
        `count_if(trim(${q}) = '')::BIGINT AS ${p}empty`,
        `count_if(TRY_CAST(trim(${q}) AS DOUBLE) IS NOT NULL)::BIGINT AS ${p}numeric_like`,
      );
    }
  });
  return `SELECT\n  ${parts.join(',\n  ')}\nFROM ${table}`;
}

/** Outlier counts need the quartiles, so they run as a second pass. */
export function buildOutlierSql(
  table: string,
  numeric: { index: number; name: string; q25: number; q75: number }[],
): string | null {
  if (numeric.length === 0) return null;
  const parts = numeric.map(({ index, name, q25, q75 }) => {
    const iqr = q75 - q25;
    const lo = q25 - 1.5 * iqr;
    const hi = q75 + 1.5 * iqr;
    const q = quoteIdent(name);
    return `count_if(${q} < ${lo} OR ${q} > ${hi})::BIGINT AS c${index}_outliers`;
  });
  return `SELECT ${parts.join(', ')} FROM ${table}`;
}

export function buildDuplicateSql(table: string): string {
  return `SELECT (SELECT count(*) FROM ${table}) - (SELECT count(*) FROM (SELECT DISTINCT * FROM ${table})) AS duplicate_rows`;
}
