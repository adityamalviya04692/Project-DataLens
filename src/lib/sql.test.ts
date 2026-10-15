import { describe, expect, it } from 'vitest';
import { columnKind, quoteIdent, quoteLiteral, timeGrain } from './sql';
import { buildOutlierSql, buildStatsSql, toColumnMeta } from './profileSql';
import { buildHtmlReport, escapeHtml } from './report';
import { assessQuality } from './quality';
import { col, dataset } from './testUtils';

describe('sql helpers', () => {
  it('quotes identifiers and literals', () => {
    expect(quoteIdent('a"b')).toBe('"a""b"');
    expect(quoteLiteral("it's")).toBe("'it''s'");
  });

  it('classifies DuckDB types', () => {
    expect(['DECIMAL(10,2)', 'BIGINT', 'TIMESTAMP WITH TIME ZONE', 'DATE', 'BOOLEAN', 'VARCHAR', 'TIME', 'INTEGER[]', 'STRUCT(a INTEGER)'].map(columnKind)).toEqual([
      'numeric', 'numeric', 'temporal', 'temporal', 'boolean', 'text', 'other', 'other', 'other',
    ]);
  });

  it('picks a readable time grain', () => {
    expect([30, 200, 1000, 5000].map(timeGrain)).toEqual(['day', 'week', 'month', 'year']);
  });
});

describe('profile SQL', () => {
  const cols = toColumnMeta([
    { column_name: 'price', column_type: 'DOUBLE' },
    { column_name: 'city', column_type: 'VARCHAR' },
  ]);

  it('computes type-specific metrics with positional aliases', () => {
    const sql = buildStatsSql('data', cols);
    expect(sql).toContain('quantile_cont("price", 0.25)::DOUBLE AS c0_q25');
    expect(sql).toContain('count_if("city" <> trim("city"))::BIGINT AS c1_whitespace');
    expect(sql).not.toContain('c1_q25');
  });

  it('uses the 1.5 × IQR fences for outliers', () => {
    expect(buildOutlierSql('data', [{ index: 0, name: 'price', q25: 10, q75: 20 }])).toBe(
      'SELECT count_if("price" < -5 OR "price" > 35)::BIGINT AS c0_outliers FROM data',
    );
    expect(buildOutlierSql('data', [])).toBeNull();
  });
});

describe('html report', () => {
  it('escapes user-controlled text', () => {
    expect(escapeHtml('<script>"x"</script>')).toBe('&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
    const p = dataset([col('<b>name</b>', 'VARCHAR', { whitespace: 1 })]);
    const html = buildHtmlReport('<evil>.csv', p, assessQuality(p), new Date('2026-01-01T00:00:00Z'));
    expect(html).not.toContain('<evil>');
    expect(html).not.toContain('<b>name</b>');
    expect(html).toContain('2026-01-01 00:00 UTC');
  });
});
