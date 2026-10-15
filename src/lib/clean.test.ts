import { describe, expect, it } from 'vitest';
import { buildCleanSql, DEFAULT_CLEAN_OPTIONS } from './clean';
import { col, dataset } from './testUtils';

const profile = dataset([
  col('id', 'BIGINT'),
  col('city', 'VARCHAR', { whitespace: 4 }),
  col('delivery_days', 'VARCHAR', { numericLike: 97 }),
  col('notes', 'VARCHAR', { count: 0, distinct: 0 }),
]);

describe('buildCleanSql', () => {
  it('applies every default rule in one statement', () => {
    expect(buildCleanSql(profile, DEFAULT_CLEAN_OPTIONS)).toBe(
      [
        'CREATE OR REPLACE TABLE clean AS',
        'SELECT DISTINCT ',
        '  "id",',
        `  NULLIF(trim("city"), '') AS "city",`,
        `  TRY_CAST(NULLIF(trim("delivery_days"), '') AS DOUBLE) AS "delivery_days"`,
        'FROM data',
      ].join('\n'),
    );
  });

  it('keeps columns and rows untouched when every rule is off', () => {
    const off = { dedupe: false, trimText: false, emptyToNull: false, dropEmptyColumns: false, castNumericText: false };
    const sql = buildCleanSql(profile, off);
    expect(sql).not.toContain('DISTINCT');
    expect(sql).toContain('"notes"');
    expect(sql).not.toContain('trim(');
  });

  it('still trims before casting when trimming is disabled', () => {
    const sql = buildCleanSql(profile, { ...DEFAULT_CLEAN_OPTIONS, trimText: false });
    expect(sql).toContain(`TRY_CAST(trim(NULLIF("delivery_days", '')) AS DOUBLE)`);
  });

  it('quotes awkward column names', () => {
    const sql = buildCleanSql(dataset([col('say "hi"', 'VARCHAR')]), DEFAULT_CLEAN_OPTIONS);
    expect(sql).toContain('AS "say ""hi"""');
  });
});
