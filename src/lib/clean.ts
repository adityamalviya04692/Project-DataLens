import { quoteIdent } from './sql';
import { isNumericText } from './quality';
import type { DatasetProfile } from './types';

export interface CleanOptions {
  dedupe: boolean;
  trimText: boolean;
  emptyToNull: boolean;
  dropEmptyColumns: boolean;
  castNumericText: boolean;
}

export const DEFAULT_CLEAN_OPTIONS: CleanOptions = {
  dedupe: true,
  trimText: true,
  emptyToNull: true,
  dropEmptyColumns: true,
  castNumericText: true,
};

/**
 * Build a single, readable CREATE TABLE AS statement that applies the selected
 * fixes. The SQL is shown to the user, so it doubles as documentation.
 */
export function buildCleanSql(p: DatasetProfile, o: CleanOptions, target = 'clean'): string {
  const selects: string[] = [];
  for (const c of p.columns) {
    if (o.dropEmptyColumns && p.rows > 0 && c.count === 0) continue;
    const q = quoteIdent(c.name);
    let expr = q;
    if (c.kind === 'text') {
      if (o.trimText) expr = `trim(${expr})`;
      if (o.emptyToNull) expr = `NULLIF(${expr}, '')`;
      if (o.castNumericText && isNumericText(c)) expr = `TRY_CAST(${o.trimText ? expr : `trim(${expr})`} AS DOUBLE)`;
    }
    selects.push(expr === q ? q : `${expr} AS ${q}`);
  }
  if (selects.length === 0) selects.push('*');
  const distinct = o.dedupe ? 'DISTINCT ' : '';
  return `CREATE OR REPLACE TABLE ${target} AS\nSELECT ${distinct}\n  ${selects.join(',\n  ')}\nFROM ${p.table}`;
}
